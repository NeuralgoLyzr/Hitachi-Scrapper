import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
from app.api.v1.auth import router as auth_router
from app.api.v1.contacts_enriched import router as contacts_enriched_router
from app.api.v1.jobs import router as jobs_router


app = FastAPI(title="Contact Enrich FastAPI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(contacts_enriched_router, prefix="/api/v1")
