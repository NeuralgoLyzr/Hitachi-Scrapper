from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import get_current_user
from app.db.mongo import get_collection
from app.utils import normalize_doc


router = APIRouter(tags=["contacts"])


@router.get("/contacts-enriched")
def list_contacts_enriched(
    job_id: str = Query(..., description="MongoDB job id"),
    current_user=Depends(get_current_user),
):
    try:
        oid = ObjectId(job_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid job_id")

    jobs = get_collection("jobs")
    job = jobs.find_one({"_id": oid, "owner_user_id": str(current_user["_id"])})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    contacts = get_collection("contacts")
    cursor = contacts.find({"job_id": job_id})
    rows = [normalize_doc(x) for x in cursor]

    return {"success": True, "data": rows, "total": len(rows)}
