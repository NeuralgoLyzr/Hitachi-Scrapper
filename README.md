# FastAPI Backend

## Run locally

1. Create virtualenv and install deps:
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and set values.
3. Start server:
   - `uvicorn app.main:app --reload --port 8000`

Base URL: `http://localhost:8000/api/v1`
