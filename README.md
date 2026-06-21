# Diet Monitor

A mobile-friendly diet tracking web app built with Python (FastAPI), SQLite, and Tailwind CSS. Log your meals, track macros, monitor your weight, and get personalized calorie targets — all from your phone browser.

---

## Features

- **Weekly calendar strip** — see all 7 days at a glance with color-coded completion indicators
- **Meal categories** — log Breakfast, Lunch, Dinner, and Snacks separately
- **Food search** — powered by USDA FoodData Central (millions of US grocery/branded items) with Open Food Facts as fallback
- **Voice input** — tap the mic and speak a food name to search hands-free
- **Multi-item cart** — add multiple foods before saving, with a live running calorie total
- **Macro tracking** — calories, protein, carbs, and fat with progress bars toward daily goals
- **Profile & TDEE** — enter your height, weight, age, gender, and activity level to get personalized calorie and macro targets calculated via the Mifflin-St Jeor formula
- **Weight history** — log your weight over time and view progress
- **History view** — see daily totals for the past 7+ days

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| Database | SQLite (via aiosqlite) |
| Templates | Jinja2 |
| Frontend | Tailwind CSS (CDN), Vanilla JS |
| Food Data | USDA FoodData Central API + Open Food Facts API |

---

## Project Structure

```
diet-monitor/
├── main.py          # FastAPI app, routes, API endpoints
├── database.py      # SQLite schema, queries, TDEE calculations
├── requirements.txt
├── Procfile         # For Render/Heroku deployment
├── render.yaml      # Render deployment config
├── templates/
│   ├── base.html    # Shared layout with nav and weekly calendar
│   ├── index.html   # Today's dashboard
│   ├── log.html     # Log food page (search, cart, voice)
│   ├── history.html # Past days summary
│   └── profile.html # Profile, weight tracking, suggested goals
└── static/
    └── app.js       # Frontend JS (search, cart, voice, profile)
```

---

## Setup

### 1. Prerequisites

- Python 3.11+
- A free [USDA FoodData Central API key](https://fdc.nal.usda.gov/api-key-signup/)

### 2. Install dependencies

```bash
cd diet-monitor
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Set your USDA API key

```bash
echo 'export USDA_API_KEY="your_key_here"' >> ~/.zshrc
source ~/.zshrc
```

### 4. Run locally

```bash
uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000` in your browser (or on your phone if on the same WiFi using your computer's local IP).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `USDA_API_KEY` | *(none)* | Required for USDA food search |
| `DB_PATH` | `diet_monitor.db` | SQLite database file path |
| `PORT` | `8000` | Port used by Procfile on deployment |

---

## Deploying Online (Render.com)

1. Push this folder to a GitHub repository
2. Sign up at [render.com](https://render.com) (free tier available)
3. Click **New Web Service** → connect your GitHub repo
4. Render auto-detects `render.yaml` and deploys automatically
5. Add `USDA_API_KEY` in Render's **Environment** settings
6. Your app will be live at `https://your-app-name.onrender.com`

---

## Food Search Priority

When you search for a food, the app checks sources in this order:

1. **Your custom foods** (anything you've saved)
2. **Local built-in list** (30 common foods, always instant)
3. **USDA FoodData Central** (primary — millions of US/branded items)
4. **Open Food Facts** (fallback if USDA is unavailable)

---

## Notes

- The SQLite database is created automatically on first run
- Goals default to 2000 kcal / 150g protein / 250g carbs / 65g fat until you set your profile
- Suggested goals use the Mifflin-St Jeor TDEE formula and update automatically when you save your profile
- Voice input uses the browser's built-in Web Speech API — works on Chrome and Safari
