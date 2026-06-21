import asyncpg
import os
from datetime import date, timedelta, datetime

DATABASE_URL = os.environ.get("DATABASE_URL", "")

DEFAULT_GOALS = {
    "calories": 2000,
    "protein":  150,
    "carbs":    250,
    "fat":      65,
}

ACTIVITY_MULTIPLIERS = {
    "sedentary":   1.2,
    "light":       1.375,
    "moderate":    1.55,
    "active":      1.725,
    "very_active": 1.9,
}

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, ssl="require", min_size=1, max_size=5)
    return _pool


def _row(record) -> dict:
    if record is None:
        return {}
    d = dict(record)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.strftime("%Y-%m-%d %H:%M:%S")
        elif isinstance(v, date):
            d[k] = v.isoformat()
    return d


def _rows(records) -> list[dict]:
    return [_row(r) for r in records]


# ── Schema init ───────────────────────────────────────────────────────────────

async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS food_logs (
                id             SERIAL PRIMARY KEY,
                date           TEXT      NOT NULL,
                food_name      TEXT      NOT NULL,
                calories       REAL      NOT NULL DEFAULT 0,
                protein        REAL      NOT NULL DEFAULT 0,
                carbs          REAL      NOT NULL DEFAULT 0,
                fat            REAL      NOT NULL DEFAULT 0,
                quantity_grams REAL      NOT NULL DEFAULT 100,
                meal_type      TEXT      NOT NULL DEFAULT 'snacks',
                logged_at      TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_goals (
                id       SERIAL PRIMARY KEY,
                calories REAL NOT NULL DEFAULT 2000,
                protein  REAL NOT NULL DEFAULT 150,
                carbs    REAL NOT NULL DEFAULT 250,
                fat      REAL NOT NULL DEFAULT 65
            )
        """)

        count = await conn.fetchval("SELECT COUNT(*) FROM daily_goals")
        if count == 0:
            await conn.execute(
                "INSERT INTO daily_goals (calories, protein, carbs, fat) VALUES ($1,$2,$3,$4)",
                DEFAULT_GOALS["calories"], DEFAULT_GOALS["protein"],
                DEFAULT_GOALS["carbs"],    DEFAULT_GOALS["fat"],
            )

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_profile (
                id         INTEGER PRIMARY KEY DEFAULT 1,
                height_cm  REAL,
                weight_kg  REAL,
                age        INTEGER,
                gender     TEXT,
                activity   TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS weight_history (
                id        SERIAL PRIMARY KEY,
                weight_kg REAL      NOT NULL,
                date      TEXT      NOT NULL,
                note      TEXT,
                logged_at TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS custom_foods (
                id                SERIAL PRIMARY KEY,
                name              TEXT NOT NULL,
                calories_per_100g REAL NOT NULL DEFAULT 0,
                protein_per_100g  REAL NOT NULL DEFAULT 0,
                carbs_per_100g    REAL NOT NULL DEFAULT 0,
                fat_per_100g      REAL NOT NULL DEFAULT 0,
                unit              TEXT NOT NULL DEFAULT 'g',
                unit_label        TEXT NOT NULL DEFAULT 'grams',
                grams_per_unit    REAL,
                created_at        TIMESTAMP DEFAULT NOW()
            )
        """)


# ── Goals ─────────────────────────────────────────────────────────────────────

async def get_goals() -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT calories, protein, carbs, fat FROM daily_goals ORDER BY id DESC LIMIT 1"
        )
        return _row(row) if row else DEFAULT_GOALS.copy()


async def save_goals(calories: float, protein: float, carbs: float, fat: float) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO daily_goals (calories, protein, carbs, fat) VALUES ($1,$2,$3,$4)",
            calories, protein, carbs, fat,
        )


# ── Food logs ─────────────────────────────────────────────────────────────────

async def get_today_logs() -> list[dict]:
    today = date.today().isoformat()
    pool  = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, food_name, calories, protein, carbs, fat,
                      quantity_grams, logged_at, meal_type
               FROM food_logs WHERE date = $1 ORDER BY logged_at ASC""",
            today,
        )
        return _rows(rows)


async def get_today_totals() -> dict:
    today = date.today().isoformat()
    pool  = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT COALESCE(SUM(calories),0) AS calories,
                      COALESCE(SUM(protein),0)  AS protein,
                      COALESCE(SUM(carbs),0)    AS carbs,
                      COALESCE(SUM(fat),0)      AS fat
               FROM food_logs WHERE date = $1""",
            today,
        )
        return _row(row) if row else {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}


async def insert_food_log(
    food_name: str,
    calories: float,
    protein: float,
    carbs: float,
    fat: float,
    quantity_grams: float,
    meal_type: str = "snacks",
) -> int:
    today = date.today().isoformat()
    if meal_type not in {"breakfast", "lunch", "dinner", "snacks"}:
        meal_type = "snacks"
    pool = await get_pool()
    async with pool.acquire() as conn:
        row_id = await conn.fetchval(
            """INSERT INTO food_logs
               (date, food_name, calories, protein, carbs, fat, quantity_grams, meal_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
            today, food_name, calories, protein, carbs, fat, quantity_grams, meal_type,
        )
        return row_id


async def delete_food_log(log_id: int) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM food_logs WHERE id = $1", log_id)
        return int(result.split()[-1]) > 0


async def get_history(days: int = 7) -> list[dict]:
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    pool  = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT date,
                      COALESCE(SUM(calories),0) AS calories,
                      COALESCE(SUM(protein),0)  AS protein,
                      COALESCE(SUM(carbs),0)    AS carbs,
                      COALESCE(SUM(fat),0)      AS fat,
                      COUNT(*) AS entries
               FROM food_logs WHERE date >= $1
               GROUP BY date ORDER BY date DESC""",
            start,
        )
        return _rows(rows)


# ── User profile ──────────────────────────────────────────────────────────────

async def get_profile() -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, height_cm, weight_kg, age, gender, activity, updated_at "
            "FROM user_profile ORDER BY id LIMIT 1"
        )
        return _row(row) if row else None


async def save_profile(
    height_cm: float | None,
    weight_kg: float | None,
    age: int | None,
    gender: str | None,
    activity: str | None,
) -> None:
    now  = datetime.utcnow()
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM user_profile LIMIT 1")
        if existing:
            await conn.execute(
                """UPDATE user_profile
                   SET height_cm=$1, weight_kg=$2, age=$3, gender=$4, activity=$5, updated_at=$6
                   WHERE id=$7""",
                height_cm, weight_kg, age, gender, activity, now, existing,
            )
        else:
            await conn.execute(
                """INSERT INTO user_profile (id, height_cm, weight_kg, age, gender, activity, updated_at)
                   VALUES (1,$1,$2,$3,$4,$5,$6)""",
                height_cm, weight_kg, age, gender, activity, now,
            )


# ── Weight history ────────────────────────────────────────────────────────────

async def log_weight(weight_kg: float, note: str = "") -> int:
    today = date.today().isoformat()
    pool  = await get_pool()
    async with pool.acquire() as conn:
        row_id = await conn.fetchval(
            "INSERT INTO weight_history (weight_kg, date, note) VALUES ($1,$2,$3) RETURNING id",
            weight_kg, today, note or None,
        )
        return row_id


async def get_weight_history(days: int = 30) -> list[dict]:
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    pool  = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, weight_kg, date, note, logged_at
               FROM weight_history WHERE date >= $1
               ORDER BY date DESC, logged_at DESC""",
            start,
        )
        return _rows(rows)


# ── TDEE / suggested goals ────────────────────────────────────────────────────

def calculate_suggested_goals(profile: dict) -> dict:
    weight   = profile.get("weight_kg") or 0
    height   = profile.get("height_cm") or 0
    age      = profile.get("age")       or 0
    gender   = (profile.get("gender")   or "male").lower()
    activity = profile.get("activity")  or "sedentary"

    if weight <= 0 or height <= 0 or age <= 0:
        return DEFAULT_GOALS.copy()

    if gender == "female":
        bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161
    else:
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5

    tdee      = bmr * ACTIVITY_MULTIPLIERS.get(activity, 1.2)
    protein_g = weight * 1.6
    fat_g     = tdee * 0.25 / 9
    carbs_g   = (tdee - protein_g * 4 - fat_g * 9) / 4

    return {
        "calories": round(tdee),
        "protein":  round(protein_g),
        "carbs":    round(max(carbs_g, 0)),
        "fat":      round(fat_g),
    }


# ── Weekly calendar status ────────────────────────────────────────────────────

async def get_week_status() -> list[dict]:
    today     = date.today()
    monday    = today - timedelta(days=today.isoweekday() - 1)
    week_dates = [monday + timedelta(days=i) for i in range(7)]
    day_names  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    start      = monday.isoformat()
    end        = (monday + timedelta(days=6)).isoformat()

    goals        = await get_goals()
    calorie_goal = goals["calories"]

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT date, COALESCE(SUM(calories),0) AS total_calories, COUNT(*) AS entries
               FROM food_logs WHERE date >= $1 AND date <= $2 GROUP BY date""",
            start, end,
        )

    log_map = {r["date"]: dict(r) for r in rows}

    result = []
    for i, d in enumerate(week_dates):
        d_str    = d.isoformat()
        log_day  = log_map.get(d_str)
        has_logs = bool(log_day and log_day["entries"] > 0)
        met_goal = bool(
            has_logs and calorie_goal > 0 and log_day["total_calories"] >= calorie_goal * 0.9
        )
        result.append({
            "date":             d_str,
            "day_name":         day_names[i],
            "day_num":          d.day,
            "is_today":         d == today,
            "has_logs":         has_logs,
            "met_calorie_goal": met_goal,
        })

    return result


# ── Custom foods ──────────────────────────────────────────────────────────────

async def get_custom_foods() -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM custom_foods ORDER BY name ASC")
        return _rows(rows)


async def search_custom_foods(query: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM custom_foods WHERE name ILIKE $1 ORDER BY name ASC LIMIT 10",
            f"%{query}%",
        )
        return _rows(rows)


async def insert_custom_food(
    name: str,
    calories_per_100g: float,
    protein_per_100g: float,
    carbs_per_100g: float,
    fat_per_100g: float,
    unit: str = "g",
    unit_label: str = "grams",
    grams_per_unit: float | None = None,
) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row_id = await conn.fetchval(
            """INSERT INTO custom_foods
               (name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                unit, unit_label, grams_per_unit)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
            name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
            unit, unit_label, grams_per_unit,
        )
        return row_id


async def delete_custom_food(food_id: int) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM custom_foods WHERE id = $1", food_id)
        return int(result.split()[-1]) > 0
