import aiosqlite
import os
from datetime import date, timedelta, datetime

DB_PATH = os.environ.get("DB_PATH", "diet_monitor.db")

DEFAULT_GOALS = {
    "calories": 2000,
    "protein": 150,
    "carbs": 250,
    "fat": 65,
}

ACTIVITY_MULTIPLIERS = {
    "sedentary":   1.2,
    "light":       1.375,
    "moderate":    1.55,
    "active":      1.725,
    "very_active": 1.9,
}


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # ── food_logs ─────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS food_logs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                date           TEXT    NOT NULL,
                food_name      TEXT    NOT NULL,
                calories       REAL    NOT NULL DEFAULT 0,
                protein        REAL    NOT NULL DEFAULT 0,
                carbs          REAL    NOT NULL DEFAULT 0,
                fat            REAL    NOT NULL DEFAULT 0,
                quantity_grams REAL    NOT NULL DEFAULT 100,
                logged_at      TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Migration: add meal_type column if it doesn't exist yet
        try:
            await db.execute(
                "ALTER TABLE food_logs ADD COLUMN meal_type TEXT NOT NULL DEFAULT 'snacks'"
            )
        except Exception:
            pass  # Column already exists — ignore

        # ── daily_goals ───────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS daily_goals (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                calories REAL NOT NULL DEFAULT 2000,
                protein  REAL NOT NULL DEFAULT 150,
                carbs    REAL NOT NULL DEFAULT 250,
                fat      REAL NOT NULL DEFAULT 65
            )
        """)

        # Seed default goals if table is empty
        cursor = await db.execute("SELECT COUNT(*) FROM daily_goals")
        row = await cursor.fetchone()
        if row[0] == 0:
            await db.execute(
                "INSERT INTO daily_goals (calories, protein, carbs, fat) VALUES (?, ?, ?, ?)",
                (
                    DEFAULT_GOALS["calories"],
                    DEFAULT_GOALS["protein"],
                    DEFAULT_GOALS["carbs"],
                    DEFAULT_GOALS["fat"],
                ),
            )

        # ── user_profile ──────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_profile (
                id         INTEGER PRIMARY KEY,
                height_cm  REAL,
                weight_kg  REAL,
                age        INTEGER,
                gender     TEXT,
                activity   TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # ── weight_history ────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS weight_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                weight_kg REAL NOT NULL,
                date      TEXT NOT NULL,
                note      TEXT,
                logged_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.commit()


# ── Goals ─────────────────────────────────────────────────────────────────────

async def get_goals() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT calories, protein, carbs, fat FROM daily_goals ORDER BY id DESC LIMIT 1"
        )
        row = await cursor.fetchone()
        if row:
            return {
                "calories": row["calories"],
                "protein":  row["protein"],
                "carbs":    row["carbs"],
                "fat":      row["fat"],
            }
        return DEFAULT_GOALS.copy()


async def save_goals(calories: float, protein: float, carbs: float, fat: float) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO daily_goals (calories, protein, carbs, fat) VALUES (?, ?, ?, ?)",
            (calories, protein, carbs, fat),
        )
        await db.commit()


# ── Food logs ─────────────────────────────────────────────────────────────────

async def get_today_logs() -> list[dict]:
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, food_name, calories, protein, carbs, fat,
                      quantity_grams, logged_at, meal_type
               FROM food_logs
               WHERE date = ?
               ORDER BY logged_at ASC""",
            (today,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_today_totals() -> dict:
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT COALESCE(SUM(calories),0) AS calories,
                      COALESCE(SUM(protein),0)  AS protein,
                      COALESCE(SUM(carbs),0)    AS carbs,
                      COALESCE(SUM(fat),0)      AS fat
               FROM food_logs WHERE date = ?""",
            (today,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}


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
    valid_meal_types = {"breakfast", "lunch", "dinner", "snacks"}
    if meal_type not in valid_meal_types:
        meal_type = "snacks"
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO food_logs
               (date, food_name, calories, protein, carbs, fat, quantity_grams, meal_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (today, food_name, calories, protein, carbs, fat, quantity_grams, meal_type),
        )
        await db.commit()
        return cursor.lastrowid


async def delete_food_log(log_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM food_logs WHERE id = ?", (log_id,))
        await db.commit()
        return cursor.rowcount > 0


async def get_history(days: int = 7) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT date,
                      COALESCE(SUM(calories),0) AS calories,
                      COALESCE(SUM(protein),0)  AS protein,
                      COALESCE(SUM(carbs),0)    AS carbs,
                      COALESCE(SUM(fat),0)      AS fat,
                      COUNT(*) AS entries
               FROM food_logs
               WHERE date >= date('now', ?)
               GROUP BY date
               ORDER BY date DESC""",
            (f"-{days - 1} days",),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ── User profile ──────────────────────────────────────────────────────────────

async def get_profile() -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, height_cm, weight_kg, age, gender, activity, updated_at "
            "FROM user_profile ORDER BY id DESC LIMIT 1"
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def save_profile(
    height_cm: float | None,
    weight_kg: float | None,
    age: int | None,
    gender: str | None,
    activity: str | None,
) -> None:
    now = datetime.utcnow().isoformat(sep=" ", timespec="seconds")
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT id FROM user_profile ORDER BY id LIMIT 1")
        existing = await cursor.fetchone()
        if existing:
            await db.execute(
                """UPDATE user_profile
                   SET height_cm=?, weight_kg=?, age=?, gender=?, activity=?, updated_at=?
                   WHERE id=?""",
                (height_cm, weight_kg, age, gender, activity, now, existing[0]),
            )
        else:
            await db.execute(
                """INSERT INTO user_profile
                   (id, height_cm, weight_kg, age, gender, activity, updated_at)
                   VALUES (1, ?, ?, ?, ?, ?, ?)""",
                (height_cm, weight_kg, age, gender, activity, now),
            )
        await db.commit()


# ── Weight history ────────────────────────────────────────────────────────────

async def log_weight(weight_kg: float, note: str = "") -> int:
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO weight_history (weight_kg, date, note) VALUES (?, ?, ?)",
            (weight_kg, today, note or None),
        )
        await db.commit()
        return cursor.lastrowid


async def get_weight_history(days: int = 30) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, weight_kg, date, note, logged_at
               FROM weight_history
               WHERE date >= date('now', ?)
               ORDER BY date DESC, logged_at DESC""",
            (f"-{days - 1} days",),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ── TDEE / suggested goals ────────────────────────────────────────────────────

def calculate_suggested_goals(profile: dict) -> dict:
    """
    Mifflin-St Jeor TDEE calculation.
    Returns dict with calories, protein, carbs, fat (all rounded to int).
    """
    weight   = profile.get("weight_kg") or 0
    height   = profile.get("height_cm") or 0
    age      = profile.get("age") or 0
    gender   = (profile.get("gender") or "male").lower()
    activity = profile.get("activity") or "sedentary"

    if weight <= 0 or height <= 0 or age <= 0:
        return DEFAULT_GOALS.copy()

    if gender == "female":
        bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161
    else:
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5

    multiplier = ACTIVITY_MULTIPLIERS.get(activity, 1.2)
    tdee = bmr * multiplier

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
    """
    Returns 7 dicts representing Mon–Sun of the current ISO week.
    Each dict: date, day_name, day_num, is_today, has_logs, met_calorie_goal
    """
    today  = date.today()
    monday = today - timedelta(days=today.isoweekday() - 1)

    week_dates = [monday + timedelta(days=i) for i in range(7)]
    day_names  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    start = monday.isoformat()
    end   = (monday + timedelta(days=6)).isoformat()

    goals = await get_goals()
    calorie_goal = goals["calories"]

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT date,
                      COALESCE(SUM(calories), 0) AS total_calories,
                      COUNT(*) AS entries
               FROM food_logs
               WHERE date >= ? AND date <= ?
               GROUP BY date""",
            (start, end),
        )
        rows = await cursor.fetchall()

    log_map: dict[str, dict] = {r["date"]: dict(r) for r in rows}

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
