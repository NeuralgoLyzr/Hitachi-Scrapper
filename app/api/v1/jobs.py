import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from pymongo import ReturnDocument

from app.auth.deps import get_current_user
from app.db.mongo import get_collection
from app.services.enrichments import run_enrichment_task
from app.utils import normalize_doc


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])



@router.get("")
def list_jobs(
    current_user=Depends(get_current_user),
    page: int = Query(1, ge=1, description="1-based page index"),
    page_size: int = Query(5, ge=1, le=100),
):
    jobs = get_collection("jobs")
    owner = str(current_user["_id"])
    flt = {"owner_user_id": owner}

    total = jobs.count_documents(flt)
    skip = (page - 1) * page_size
    cursor = jobs.find(flt).sort("createdAt", -1).skip(skip).limit(page_size)
    rows = [normalize_doc(x) for x in cursor]

    agg = list(
        jobs.aggregate(
            [
                {"$match": flt},
                {
                    "$group": {
                        "_id": None,
                        "contacts_enriched": {"$sum": {"$ifNull": ["$contacts_filtered", 0]}},
                        "completed_jobs": {
                            "$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}
                        },
                    }
                },
            ]
        )
    )
    stats_row = agg[0] if agg else {}
    stats = {
        "total_jobs": total,
        "contacts_enriched": int(stats_row.get("contacts_enriched", 0)),
        "completed_jobs": int(stats_row.get("completed_jobs", 0)),
    }

    return {
        "success": True,
        "data": rows,
        "page": page,
        "page_size": page_size,
        "total": total,
        "stats": stats,
    }


@router.post("")
def create_job(
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    filename: str | None = Query(
        default=None,
        description="Fallback file name when body is a raw JSON array (prefer filename inside JSON body)",
    ),
    body: Any = Body(...),
):
    jobs = get_collection("jobs")
    owner_user_id = str(current_user["_id"])

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "filename": filename,
        "total_companies": len(body["rows"]),
        "status": "processing",
        "owner_user_id": owner_user_id,
        "createdAt": now,
        "updatedAt": now,
    }

    result = jobs.insert_one(payload)
    job_id = str(result.inserted_id)

    logger.info(
        "job created job_id=%s owner_user_id=%s total_companies=%s filename=%s",
        job_id,
        owner_user_id,
        len(body.get("rows", [])),
        filename,
    )
    background_tasks.add_task(run_enrichment_task, job_id, owner_user_id, body)
    # run_enrichment_task(job_id, owner_user_id, body)
    created = jobs.find_one({"_id": result.inserted_id})
    return {"success": True, "data": normalize_doc(created)}


@router.get("/{job_id}")
def get_job(job_id: str, current_user=Depends(get_current_user)):
    jobs = get_collection("jobs")
    row = jobs.find_one({"_id": ObjectId(job_id), "owner_user_id": str(current_user["_id"])})
    if not row:
        logger.warning("get_job not found job_id=%s owner=%s", job_id, current_user["_id"])
        raise HTTPException(status_code=404, detail="Job not found")
    logger.debug(
        "get_job job_id=%s status=%s",
        job_id,
        row.get("status"),
    )
    return {"success": True, "data": normalize_doc(row)}


