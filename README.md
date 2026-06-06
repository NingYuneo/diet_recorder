# Diet Monitor

A lightweight diet tracking web app built with FastAPI, SQLite, and Jinja2 templates.

## Overview

This app helps you track daily food intake, nutrient totals, and weekly progress. It includes:

- A dashboard with today’s calorie, protein, carb, and fat totals
- Food logging with meal categories and quantity-based nutrient calculations
- Profile and weight history tracking
- Daily goals that can be saved and updated
- History view showing multiple days of logged data
- A fallback food search powered by the OpenFoodFacts API and a local common-food database

## Key components

- `main.py` – application entry point, routes, page rendering, API endpoints
- `database.py` – SQLite schema, data access, goals, profile, weight history, weekly status
- `templates/` – Jinja2 templates for UI pages
- `static/` – frontend assets (JavaScript, CSS, etc.)
- `requirements.txt` – Python dependencies
- `Procfile` – deployment command for platforms like Heroku

## Features

- Log meals with calories, protein, carbs, fat, and grams
- Search common foods via OpenFoodFacts and local fallback list
- Scan a product label with your phone camera and parse nutrition details
- View today’s logs and nutrient totals
- Save or update daily macronutrient goals
- Track weight history and user profile
- See weekly progress with a status calendar

## Requirements

- Python 3.11+ (or compatible Python version)
- `pip` for package installation
- Tesseract OCR installed on your system for label scan support

## Installation

For macOS, install Tesseract before running the app:
```bash
brew install tesseract
```

1. Create a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running Locally

Start the app with Uvicorn:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open `http://127.0.0.1:8000` in your browser.

## Environment

- `DB_PATH` – optional SQLite file path (default: `diet_monitor.db`)
- `PORT` – used by `Procfile` for deployment

## Deployment

The included `Procfile` starts the app with Uvicorn:

```text
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Notes

- The database initializes automatically when the app starts.
- If the OpenFoodFacts API is unavailable, the app falls back to a built-in common food list.
- User profile data is used to calculate suggested goals via a Mifflin-St Jeor TDEE estimate.

## Next edits

You can customize this README later with:

- a screenshot or UI walkthrough
- deployment steps for a specific provider
- more detailed API documentation
- contribution guidelines
