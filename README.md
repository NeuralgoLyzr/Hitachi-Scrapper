# Contact Enrich — FastAPI backend

REST API for contact enrichment jobs: users authenticate with JWT, create jobs from company rows, and the server enriches contacts via **Apollo** (orgs / people) and **Lyzr** (AI research fields). Data is stored in **MongoDB**.

## Requirements

- **Python** 3.11+ (3.14 works with the current dependency set)
- **MongoDB** reachable at the URL you configure (local or Atlas)
- **Apollo** and **Lyzr** API credentials (see environment variables)

## Quick start

1. **Create a virtual environment and install dependencies**

   ```bash
   cd backend-fastapi
   python3 -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure environment**

   Copy the example file and fill in every variable (all are required):

   ```bash
   cp .env.example .env
   ```

   See [Environment variables](#environment-variables) below for what each key does.

3. **Run the API**

   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

   - **Base URL:** `http://localhost:8000/api/v1`
   - **OpenAPI (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)
   - **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

## Environment variables

Configuration is loaded from the process environment and from a `.env` file in the project root (via [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)). Names are uppercase; see `.env.example` for a full template.

| Variable | Purpose |
|----------|---------|
| `MONGODB_URL` | MongoDB connection string |
| `MONGODB_DB_NAME` | Database name |
| `JWT_SECRET_KEY` | Secret for signing access tokens (use a long random value in production) |
| `JWT_ALGORITHM` | Typically `HS256` |
| `JWT_EXPIRE_MINUTES` | Access token lifetime in minutes |
| `LYZR_API_KEY` | Lyzr Studio API key |
| `LYZR_USER_ID` | Lyzr user id (email) |
| `LYZR_INDUSTRY_CLASSIFICATION_AGENT_ID` | Agent id (reserved for industry flows) |
| `LYZR_AGENT_RESEARCH_DOMAIN_ID` | Agent used for research-domain enrichment on contacts |
| `LYZR_INFERENCE_URL` | Lyzr chat inference endpoint URL |
| `LYZR_BATCH_CONCURRENCY` | Parallel Lyzr batches per job |
| `LYZR_HTTP_TIMEOUT_SECONDS` | HTTP timeout for Lyzr calls (increase if you see read timeouts) |
| `LYZR_HTTP_RETRIES` | Retries for transient HTTP failures and invalid JSON responses |
| `LYZR_HTTP_RETRY_BACKOFF_SECONDS` | Backoff between retries |
| `APOLLO_API_KEY` | Apollo.io API key |
| `APOLLO_BASE_URL` | Apollo API base (default `https://api.apollo.io/v1`) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (e.g. `http://localhost:3333`) |

Never commit `.env`; it is listed in `.gitignore`. Commit only `.env.example`.

## Authentication

Protected routes expect an **Authorization** header:

```http
Authorization: Bearer <access_token>
```

Obtain a token from:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/register` | Body: `email`, `password`, optional `name` — returns `token` and `user` |
| `POST` | `/api/v1/auth/login` | Body: `email`, `password` — returns `token` and `user` |
| `GET` | `/api/v1/auth/me` | Current user (requires Bearer token) |
| `POST` | `/api/v1/auth/logout` | Client-side logout helper (token discard) |

## API overview

All routes below are under `/api/v1` unless noted. Job and contact routes require a valid Bearer token and enforce **owner** access via `owner_user_id`.

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | Paginated list of jobs for the current user (`page`, `page_size`; includes aggregate stats) |
| `POST` | `/jobs` | Create a job. Body must include `rows` (e.g. companies with `website`). Runs enrichment in a **background task** |
| `GET` | `/jobs/{job_id}` | Single job document |
| `DELETE` | `/jobs/{job_id}` | Deletes the job and associated contacts for that job |
| `POST` | `/jobs/ai_enrichment` | Triggers or continues AI enrichment for a job (Lyzr); body includes `job_id`, optional `contact_id` |

Job `status` progresses through stages such as Apollo fetching, AI enrichment, and `completed` or `failed` depending on outcomes.

### Contacts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/contacts-enriched?job_id=...` | All enriched contacts for a job owned by the user |

## Project layout

```
app/
  main.py              # FastAPI app, CORS, routers
  config.py            # Settings (env / .env only)
  api/v1/              # auth, jobs, contacts_enriched
  auth/                # JWT, password hashing, dependencies
  db/mongo.py          # Mongo client and database handle
  services/enrichments.py   # Apollo + Lyzr enrichment pipeline
```

## Production notes

- Set a strong `JWT_SECRET_KEY` and restrict `CORS_ORIGINS` to your real front-end origins.
- Run with a production ASGI server (e.g. `uvicorn` behind a reverse proxy, or Gunicorn + Uvicorn workers).
- Tune `LYZR_HTTP_TIMEOUT_SECONDS` and `LYZR_BATCH_CONCURRENCY` for your Lyzr plan and latency.

