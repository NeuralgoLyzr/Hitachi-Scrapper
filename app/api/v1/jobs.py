import json
import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
import uuid

from app.auth.deps import get_current_user
from app.db.mongo import get_collection
from app.services.enrichments import run_enrichment_task, run_lyzr_batches_and_complete_job, _lyzr_stage1_post_until_valid_json
from app.utils import normalize_doc
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])

_CONTACT_AI_FIELDS = {
    "_id": 0,
    "contact_id": 1,
    "firm_name": 1,
    "firm_website_url": 1,
    "first_name": 1,
    "last_name": 1,
    "linkedin_profile": 1,
    "person_title": 1,
    "official_email": 1,
}


class AiEnrichmentPayload(BaseModel):
    job_id: str = Field(..., description="MongoDB job id")
    contact_id: str | None = Field(
        default=None,
        description="When set, return only this contact for the job",
    )


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


@router.delete("/{job_id}")
def delete_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    try:
        oid = ObjectId(job_id)
        owner = str(current_user["_id"])
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid job_id")

    jobs = get_collection("jobs")
    if not jobs.find_one({"_id": oid, "owner_user_id": owner}):
        logger.warning("delete_job not found job_id=%s owner=%s", job_id, owner)
        raise HTTPException(status_code=404, detail="Job not found")

    contacts = get_collection("contacts")
    contacts_result = contacts.delete_many({"job_id": job_id})
    job_result = jobs.delete_one({"_id": oid, "owner_user_id": owner})

    logger.info(
        "delete_job job_id=%s contacts_deleted=%s job_deleted=%s",
        job_id,
        contacts_result.deleted_count,
        job_result.deleted_count,
    )
    return {
        "success": True,
        "contacts_deleted": contacts_result.deleted_count,
        "job_deleted": job_result.deleted_count,
    }


@router.post("/ai_enrichment")
def ai_enrichment(
    background_tasks: BackgroundTasks,
    payload: AiEnrichmentPayload,
    current_user=Depends(get_current_user),
):

    owner_user_id = str(current_user["_id"])
    contacts = get_collection("contacts")
    cid = (payload.contact_id or "").strip() or None

    if cid is not None:
        row = contacts.find_one(
            {"job_id": payload.job_id, "contact_id": cid},
            _CONTACT_AI_FIELDS,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        try:
            
            headers={
                    "Content-Type": "application/json",
                    "x-api-key": settings.lyzr_api_key,
                }
            contact = normalize_doc(row)
            stage1_contacts = [
                {
                    "contact_id": contact.get("contact_id"),
                    "firm_name": contact.get("firm_name"),
                    "firm_website_url": contact.get("firm_website_url"),
                    "first_name": contact.get("first_name"),
                    "last_name": contact.get("last_name"),
                    "linkedin_profile": contact.get("linkedin_profile"),
                    "person_title": contact.get("person_title"),
                    "official_email": contact.get("official_email"),
                }
            ]
            payload_lyzr = {
                "user_id": settings.lyzr_user_id,
                "agent_id": settings.lyzr_agent_research_domain_id,
                "session_id": f"{settings.lyzr_agent_research_domain_id}-{uuid.uuid4().hex[:12]}",
                "message": json.dumps(stage1_contacts),
            }
            stage_result = _lyzr_stage1_post_until_valid_json(
                url=settings.lyzr_inference_url,
                headers=headers,
                payload=payload_lyzr,
                timeout=settings.lyzr_http_timeout_seconds,
                job_id=payload.job_id,
                log_label="stage1_research_domain",
            )
            if stage_result["records"] == [] or False in [False for record in stage_result["records"] if not record.get("research_coverage")]:
                stage_result = _lyzr_stage1_post_until_valid_json(
                    url=settings.lyzr_inference_url,
                    headers=headers,
                    payload=payload_lyzr,
                    timeout=settings.lyzr_http_timeout_seconds,
                    job_id=payload.job_id,
                    log_label="stage1_research_domain_retry",
                )

            stage1_records = stage_result.get("records", []) if isinstance(stage_result, dict) else []
        
            collection = get_collection("contacts")
            for contact in stage1_records:
                d = collection.find_one_and_update(
                    {"contact_id": contact["contact_id"], "job_id": payload.job_id},
                    {
                        "$set": {
                            "research_coverage": contact["research_coverage"],
                            "industry": contact["mapped_industries"],
                        }
                    },
                    return_document=True
                )
                if d:
                    d = normalize_doc(d)
                else:   
                    d = None
            return {"success": True, "data": d}
        except Exception as e:
            logger.error(f"Error running Lyzr stage 1: {e}")
            raise HTTPException(status_code=500, detail="Error running Lyzr stage 1")

    flt = {
        "job_id": payload.job_id,
        "$or": [
            {"research_coverage": ""},
            {"research_coverage": None},
        ],
    }
    cursor = contacts.find(flt, _CONTACT_AI_FIELDS)
    rows = [normalize_doc(x) for x in cursor]
    background_tasks.add_task(run_lyzr_batches_and_complete_job, payload.job_id, owner_user_id, rows)
    return {"success": True, "total": len(rows)}