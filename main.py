from contextlib import asynccontextmanager
from typing import Optional
import io
import re

import os
import httpx
from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import database

USDA_API_KEY = os.environ.get("USDA_API_KEY", "")

try:
    from PIL import Image
    import pytesseract
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not database.DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Add it in Render → your service → Environment."
        )
    await database.init_db()
    yield


# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title="Diet Monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ── Helpers ───────────────────────────────────────────────────────────────────

def pct(value: float, goal: float) -> int:
    """Return percentage clamped to 0-100."""
    if goal <= 0:
        return 0
    return min(100, int(value / goal * 100))


templates.env.globals["pct"] = pct


# ── Page routes ───────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    totals      = await database.get_today_totals()
    logs        = await database.get_today_logs()
    goals       = await database.get_goals()
    week_status = await database.get_week_status()
    profile     = await database.get_profile()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "totals":       totals,
            "logs":         logs,
            "goals":        goals,
            "week_status":  week_status,
            "profile":      profile,
        },
    )


@app.get("/log", response_class=HTMLResponse)
async def log_page(request: Request):
    return templates.TemplateResponse(request, "log.html", {})


@app.get("/history", response_class=HTMLResponse)
async def history_page(request: Request, days: int = 7):
    history = await database.get_history(days)
    goals   = await database.get_goals()
    return templates.TemplateResponse(
        request,
        "history.html",
        {"history": history, "goals": goals, "days": days},
    )


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    profile        = await database.get_profile()
    weight_history = await database.get_weight_history(30)
    return templates.TemplateResponse(
        request,
        "profile.html",
        {"profile": profile, "weight_history": weight_history},
    )


# ── Fallback food database ────────────────────────────────────────────────────

_COMMON_FOODS = [
    {"name": "Chicken Breast (cooked)",  "kcal": 165, "protein": 31.0, "carbs": 0.0,  "fat": 3.6, "unit": "g", "unit_label": "grams"},
    {"name": "Brown Rice (cooked)",      "kcal": 123, "protein": 2.7,  "carbs": 25.6, "fat": 0.9, "unit": "serving", "unit_label": "servings", "grams_per_unit": 150},
    {"name": "White Rice (cooked)",      "kcal": 130, "protein": 2.7,  "carbs": 28.2, "fat": 0.3, "unit": "serving", "unit_label": "servings", "grams_per_unit": 150},
    {"name": "Egg (whole)",              "kcal": 155, "protein": 13.0, "carbs": 1.1,  "fat": 11.0, "unit": "egg", "unit_label": "eggs", "grams_per_unit": 50},
    {"name": "Banana",                   "kcal": 89,  "protein": 1.1,  "carbs": 23.0, "fat": 0.3, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 118},
    {"name": "Apple",                    "kcal": 52,  "protein": 0.3,  "carbs": 14.0, "fat": 0.2, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 182},
    {"name": "Salmon (cooked)",          "kcal": 208, "protein": 20.0, "carbs": 0.0,  "fat": 13.0, "unit": "g", "unit_label": "grams"},
    {"name": "Broccoli",                 "kcal": 34,  "protein": 2.8,  "carbs": 7.0,  "fat": 0.4, "unit": "g", "unit_label": "grams"},
    {"name": "Sweet Potato (cooked)",    "kcal": 86,  "protein": 1.6,  "carbs": 20.1, "fat": 0.1, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 100},
    {"name": "Greek Yogurt (plain)",     "kcal": 59,  "protein": 10.0, "carbs": 3.6,  "fat": 0.4, "unit": "serving", "unit_label": "servings", "grams_per_unit": 100},
    {"name": "Oats (dry)",               "kcal": 389, "protein": 17.0, "carbs": 66.0, "fat": 7.0, "unit": "cup", "unit_label": "cups", "grams_per_unit": 80},
    {"name": "Almonds",                  "kcal": 579, "protein": 21.0, "carbs": 22.0, "fat": 50.0, "unit": "oz", "unit_label": "ounces", "grams_per_unit": 28},
    {"name": "Whole Milk",               "kcal": 61,  "protein": 3.2,  "carbs": 4.8,  "fat": 3.3, "unit": "cup", "unit_label": "cups", "grams_per_unit": 240},
    {"name": "Bread (white)",            "kcal": 265, "protein": 9.0,  "carbs": 49.0, "fat": 3.2, "unit": "slice", "unit_label": "slices", "grams_per_unit": 28},
    {"name": "Bread (whole wheat)",      "kcal": 247, "protein": 13.0, "carbs": 41.0, "fat": 4.2, "unit": "slice", "unit_label": "slices", "grams_per_unit": 28},
    {"name": "Pasta (cooked)",           "kcal": 158, "protein": 5.8,  "carbs": 31.0, "fat": 0.9, "unit": "serving", "unit_label": "servings", "grams_per_unit": 180},
    {"name": "Beef (ground, lean)",      "kcal": 215, "protein": 26.0, "carbs": 0.0,  "fat": 12.0, "unit": "g", "unit_label": "grams"},
    {"name": "Tuna (canned in water)",   "kcal": 116, "protein": 26.0, "carbs": 0.0,  "fat": 1.0, "unit": "can", "unit_label": "cans", "grams_per_unit": 142},
    {"name": "Orange",                   "kcal": 47,  "protein": 0.9,  "carbs": 12.0, "fat": 0.1, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 131},
    {"name": "Avocado",                  "kcal": 160, "protein": 2.0,  "carbs": 9.0,  "fat": 15.0, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 150},
    {"name": "Peanut Butter",            "kcal": 588, "protein": 25.0, "carbs": 20.0, "fat": 50.0, "unit": "tbsp", "unit_label": "tablespoons", "grams_per_unit": 16},
    {"name": "Cheddar Cheese",           "kcal": 402, "protein": 25.0, "carbs": 1.3,  "fat": 33.0, "unit": "oz", "unit_label": "ounces", "grams_per_unit": 28},
    {"name": "Spinach",                  "kcal": 23,  "protein": 2.9,  "carbs": 3.6,  "fat": 0.4, "unit": "cup", "unit_label": "cups", "grams_per_unit": 30},
    {"name": "Potato (boiled)",          "kcal": 87,  "protein": 1.9,  "carbs": 20.0, "fat": 0.1, "unit": "piece", "unit_label": "pieces", "grams_per_unit": 150},
    {"name": "Tofu (firm)",              "kcal": 76,  "protein": 8.0,  "carbs": 1.9,  "fat": 4.8, "unit": "serving", "unit_label": "servings", "grams_per_unit": 100},
    {"name": "Lentils (cooked)",         "kcal": 116, "protein": 9.0,  "carbs": 20.0, "fat": 0.4, "unit": "cup", "unit_label": "cups", "grams_per_unit": 198},
    {"name": "Olive Oil",                "kcal": 884, "protein": 0.0,  "carbs": 0.0,  "fat": 100.0, "unit": "tbsp", "unit_label": "tablespoons", "grams_per_unit": 14},
    {"name": "Orange Juice",             "kcal": 45,  "protein": 0.7,  "carbs": 10.4, "fat": 0.2, "unit": "cup", "unit_label": "cups", "grams_per_unit": 240},
    {"name": "Strawberries",             "kcal": 32,  "protein": 0.7,  "carbs": 7.7,  "fat": 0.3, "unit": "cup", "unit_label": "cups", "grams_per_unit": 152},
    {"name": "Turkey Breast (cooked)",   "kcal": 135, "protein": 30.0, "carbs": 0.0,  "fat": 1.0, "unit": "g", "unit_label": "grams"},
]

def _fallback_search(q: str):
    q_lower = q.lower()
    matches = [f for f in _COMMON_FOODS if q_lower in f["name"].lower()]
    return JSONResponse({"results": matches[:10], "fallback": True})


# ── API routes ────────────────────────────────────────────────────────────────

async def _search_usda(q: str) -> list[dict]:
    if not USDA_API_KEY:
        return []
    url = (
        "https://api.nal.usda.gov/fdc/v1/foods/search"
        f"?query={q}&dataType=Foundation%2CSR%20Legacy%2CBranded&pageSize=15"
        f"&api_key={USDA_API_KEY}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    results = []
    for food in data.get("foods", []):
        name = (food.get("description") or "").strip()
        if not name:
            continue
        nutrients = {n["nutrientName"]: n.get("value", 0) for n in food.get("foodNutrients", [])}
        kcal    = nutrients.get("Energy", 0)
        protein = nutrients.get("Protein", 0)
        carbs   = nutrients.get("Carbohydrate, by difference", 0)
        fat     = nutrients.get("Total lipid (fat)", 0)
        if kcal == 0 and protein == 0 and carbs == 0 and fat == 0:
            continue
        results.append({
            "name":    name,
            "kcal":    round(float(kcal or 0), 1),
            "protein": round(float(protein or 0), 1),
            "carbs":   round(float(carbs or 0), 1),
            "fat":     round(float(fat or 0), 1),
        })
        if len(results) == 15:
            break
    return results


async def _search_openfoodfacts(q: str) -> list[dict]:
    url = (
        "https://world.openfoodfacts.org/cgi/search.pl"
        f"?search_terms={q}&search_simple=1&action=process"
        "&json=1&fields=product_name,nutriments&page_size=20"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    results = []
    for product in data.get("products", []):
        name = (product.get("product_name") or "").strip()
        if not name:
            continue
        n       = product.get("nutriments", {})
        kcal    = n.get("energy-kcal_100g") or n.get("energy_100g", 0)
        protein = n.get("proteins_100g", 0)
        carbs   = n.get("carbohydrates_100g", 0)
        fat     = n.get("fat_100g", 0)
        if kcal == 0 and protein == 0 and carbs == 0 and fat == 0:
            continue
        results.append({
            "name":    name,
            "kcal":    round(float(kcal or 0), 1),
            "protein": round(float(protein or 0), 1),
            "carbs":   round(float(carbs or 0), 1),
            "fat":     round(float(fat or 0), 1),
        })
        if len(results) == 10:
            break
    return results


@app.get("/api/search")
async def search_food(q: Optional[str] = None):
    if not q or len(q.strip()) < 2:
        return JSONResponse({"results": []})

    q_lower = q.lower()

    # Custom foods always shown first
    custom_raw = await database.search_custom_foods(q)
    custom_results = [
        {
            "name":           cf["name"],
            "kcal":           cf["calories_per_100g"],
            "protein":        cf["protein_per_100g"],
            "carbs":          cf["carbs_per_100g"],
            "fat":            cf["fat_per_100g"],
            "unit":           cf["unit"],
            "unit_label":     cf["unit_label"],
            "grams_per_unit": cf["grams_per_unit"],
            "custom":         True,
            "custom_id":      cf["id"],
        }
        for cf in custom_raw
    ]

    # Local fallback list
    local_results = [f for f in _COMMON_FOODS if q_lower in f["name"].lower()]

    # USDA primary, Open Food Facts secondary
    api_results = await _search_usda(q)
    if not api_results:
        api_results = await _search_openfoodfacts(q)

    combined = custom_results + local_results + api_results
    return JSONResponse({"results": combined[:20]})



def _parse_nutrition_text(text: str) -> dict:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    parsed = {
        "food_name": None,
        "calories_per_100g": None,
        "protein_per_100g": None,
        "carbs_per_100g": None,
        "fat_per_100g": None,
    }

    patterns = {
        "calories_per_100g": re.compile(r"(\d+(?:[\.,]\d+)?)\s*(?:kcal|calories|cal)\b", re.I),
        "protein_per_100g":  re.compile(r"(\d+(?:[\.,]\d+)?)\s*(?:g\s*)?(?:protein)\b", re.I),
        "carbs_per_100g":    re.compile(r"(\d+(?:[\.,]\d+)?)\s*(?:g\s*)?(?:carb|carbs|carbohydrates)\b", re.I),
        "fat_per_100g":      re.compile(r"(\d+(?:[\.,]\d+)?)\s*(?:g\s*)?(?:fat)\b", re.I),
    }

    for line in lines:
        lower = line.lower()
        if parsed["food_name"] is None and not any(p.search(line) for p in patterns.values()):
            parsed["food_name"] = line
        for key, pattern in patterns.items():
            if parsed[key] is None:
                match = pattern.search(line)
                if match:
                    try:
                        parsed[key] = float(match.group(1).replace(",", "."))
                    except ValueError:
                        pass

    if parsed["food_name"] is None and lines:
        parsed["food_name"] = lines[0]

    # Set defaults for missing macro values
    for key in ["calories_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g"]:
        if parsed[key] is None:
            parsed[key] = 0.0

    return parsed


@app.post("/api/ocr-image")
async def ocr_image(file: UploadFile = File(...)):
    if not OCR_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="OCR is not available. Install Pillow and pytesseract, and make sure Tesseract is installed on your system.",
        )

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Uploaded file must be an image.")

    content = await file.read()
    try:
        image = Image.open(io.BytesIO(content))
        if image.mode != "RGB":
            image = image.convert("RGB")
        text = pytesseract.image_to_string(image)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse image: {exc}")

    parsed = _parse_nutrition_text(text)
    return {
        "text": text,
        "parsed": parsed,
    }


class FoodLogRequest(BaseModel):
    food_name:         str
    calories_per_100g: float
    protein_per_100g:  float
    carbs_per_100g:    float
    fat_per_100g:      float
    grams:             float
    meal_type:         str = "snacks"


@app.post("/api/log", status_code=201)
async def log_food(body: FoodLogRequest):
    if body.grams <= 0:
        raise HTTPException(status_code=422, detail="grams must be > 0")

    factor   = body.grams / 100.0
    calories = round(body.calories_per_100g * factor, 1)
    protein  = round(body.protein_per_100g  * factor, 1)
    carbs    = round(body.carbs_per_100g    * factor, 1)
    fat      = round(body.fat_per_100g      * factor, 1)

    log_id = await database.insert_food_log(
        food_name=body.food_name,
        calories=calories,
        protein=protein,
        carbs=carbs,
        fat=fat,
        quantity_grams=body.grams,
        meal_type=body.meal_type,
    )
    return {
        "id":        log_id,
        "calories":  calories,
        "protein":   protein,
        "carbs":     carbs,
        "fat":       fat,
        "meal_type": body.meal_type,
    }


@app.get("/api/today")
async def today_data():
    totals = await database.get_today_totals()
    logs   = await database.get_today_logs()
    goals  = await database.get_goals()
    return {"totals": totals, "logs": logs, "goals": goals}


class GoalsRequest(BaseModel):
    calories: float
    protein:  float
    carbs:    float
    fat:      float

@app.post("/api/goals")
async def save_goals_api(body: GoalsRequest):
    await database.save_goals(body.calories, body.protein, body.carbs, body.fat)
    return {"ok": True}


@app.delete("/api/log/{log_id}")
async def delete_log(log_id: int):
    deleted = await database.delete_food_log(log_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return {"deleted": True}


# ── Profile API ───────────────────────────────────────────────────────────────

@app.get("/api/profile")
async def get_profile_api():
    profile = await database.get_profile()
    if not profile:
        return JSONResponse({"profile": None, "suggested_goals": None})
    suggested = database.calculate_suggested_goals(profile)
    return JSONResponse({"profile": profile, "suggested_goals": suggested})


class ProfileRequest(BaseModel):
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    age:       Optional[int]   = None
    gender:    Optional[str]   = None
    activity:  Optional[str]   = None
    log_weight: bool = False


@app.post("/api/profile")
async def save_profile_api(body: ProfileRequest):
    await database.save_profile(
        height_cm=body.height_cm,
        weight_kg=body.weight_kg,
        age=body.age,
        gender=body.gender,
        activity=body.activity,
    )

    # Optionally log weight when profile is saved with a weight value
    if body.log_weight and body.weight_kg and body.weight_kg > 0:
        await database.log_weight(body.weight_kg)

    profile   = await database.get_profile()
    suggested = database.calculate_suggested_goals(profile) if profile else None
    return JSONResponse({"ok": True, "suggested_goals": suggested})


# ── Weight API ────────────────────────────────────────────────────────────────

class WeightRequest(BaseModel):
    weight_kg: float
    note:      str = ""


@app.post("/api/weight", status_code=201)
async def log_weight_api(body: WeightRequest):
    if body.weight_kg <= 0:
        raise HTTPException(status_code=422, detail="weight_kg must be > 0")
    entry_id = await database.log_weight(body.weight_kg, body.note)
    return {"id": entry_id, "weight_kg": body.weight_kg}


@app.get("/api/weight/history")
async def weight_history_api(days: int = 30):
    history = await database.get_weight_history(days)
    return JSONResponse({"history": history})


# ── Week status API ───────────────────────────────────────────────────────────

@app.get("/api/week-status")
async def week_status_api():
    status = await database.get_week_status()
    return JSONResponse({"week": status})


# ── Custom foods API ──────────────────────────────────────────────────────────

class CustomFoodRequest(BaseModel):
    name:              str
    calories_per_100g: float
    protein_per_100g:  float
    carbs_per_100g:    float
    fat_per_100g:      float
    unit:              str           = "g"
    unit_label:        str           = "grams"
    grams_per_unit:    Optional[float] = None


@app.get("/api/custom-foods")
async def list_custom_foods():
    foods = await database.get_custom_foods()
    return JSONResponse({"foods": foods})


@app.post("/api/custom-foods", status_code=201)
async def create_custom_food(body: CustomFoodRequest):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    food_id = await database.insert_custom_food(
        body.name.strip(),
        body.calories_per_100g,
        body.protein_per_100g,
        body.carbs_per_100g,
        body.fat_per_100g,
        body.unit,
        body.unit_label,
        body.grams_per_unit,
    )
    return {"id": food_id}


@app.delete("/api/custom-foods/{food_id}")
async def delete_custom_food_api(food_id: int):
    deleted = await database.delete_custom_food(food_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Custom food not found")
    return {"deleted": True}
