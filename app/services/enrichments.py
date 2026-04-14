import json
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bson import ObjectId
from fastapi import HTTPException

from app.config import settings
from app.db.mongo import get_collection

logger = logging.getLogger(__name__)

def extract_domain(url):
    parsed = urlparse(url)
    return parsed.netloc.replace("www.", "")


def get_organizations_batch(job_id, owner_user_id, firms, batch_size=10):
    org_details = []
    domains = [extract_domain(firm) for firm in firms]

    logger.info(
        "apollo org batch start job_id=%s domain_count=%s batch_size=%s",
        job_id,
        len(domains),
        batch_size,
    )

    try:
        jobs = get_collection("jobs")
        jobs.find_one_and_update(
            {"_id": ObjectId(job_id), "owner_user_id": owner_user_id},
            {"$set": {"status": "Apollo Fetching"}},
            return_document=False
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job for status Apollo Fetching: {str(e)}")

    for i in range(0, len(domains), batch_size):
        batch = domains[i:i+batch_size]
        batch_idx = i // batch_size + 1
        logger.info(
            "apollo bulk_enrich request job_id=%s batch=%s size=%s",
            job_id,
            batch_idx,
            len(batch),
        )

        payload = {
            "api_key": settings.apollo_api_key,
            "domains": batch
        }

        r = requests.post(
            f"{settings.apollo_base_url}/organizations/bulk_enrich",
            json=payload
        )

        try:
            data = r.json()
            orgs = data.get("organizations", []) if data.get("status") == "success" else []
            orgs = [org for org in (orgs or []) if org is not None]
            orgs = [
                {   
                    "id": org.get("id", ""),
                    "name": org.get("name", ""),
                    "website_url": org.get("website_url", ""),
                    "linkedin_url": org.get("linkedin_url", ""),
                    "twitter_url": org.get("twitter_url", ""),
                    "facebook_url": org.get("facebook_url", ""),
                    "primary_phone": org.get("primary_phone", {}).get("sanitized_number", ""),
                    "linkedin_uid": org.get("linkedin_uid", ""),
                    "founded_year": org.get("founded_year", ""),
                    "logo_url": org.get("logo_url", ""),
                    "primary_domain": org.get("primary_domain", ""),
                    "raw_address": org.get("raw_address", ""),
                    "street_address": org.get("street_address", ""),
                    "city": org.get("city", ""),
                    "state": org.get("state", ""),
                    "country": org.get("country", ""),
                    "postal_code": org.get("postal_code", ""),
                    "hq": f'{org.get("city", "")}, {org.get("country", "")}'
                } for org in orgs
            ]
            org_details.extend(orgs)
            logger.info(
                "apollo bulk_enrich ok job_id=%s batch=%s orgs_in_response=%s",
                job_id,
                batch_idx,
                len(orgs),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get organizations batch: {str(e)}")

    companies = get_collection("companies")
    for org in org_details:
        if not org.get("primary_domain"):
            continue  # skip if there's no key to deduplicate
        companies.update_one(
            {"primary_domain": org["primary_domain"]},  # dedupe by domain
            {"$set": org},
            upsert=True
        )


    try:
        jobs = get_collection("jobs")
        jobs.find_one_and_update(
            {"_id": ObjectId(job_id), "owner_user_id": owner_user_id},
            {"$set": {"total_companies_found": len(org_details)}},
            return_document=False
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job for total companies found on apollo: {str(e)}")

    logger.info(
        "apollo org batch done job_id=%s total_orgs=%s",
        job_id,
        len(org_details),
    )
    return org_details


def check_linkedin_profile(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10, allow_redirects=True)

        status_code = response.status_code

        # LinkedIn-specific handling
        if status_code == 200:
            return {"status": "valid", "reason": "Profile exists (public)"}

        elif status_code == 404:
            return {"status": "invalid", "reason": "Profile not found"}

        elif status_code == 999:
            return {"status": "valid", "reason": "Blocked by LinkedIn (likely exists)"}

        # Detect login wall (common case)
        elif "login" in response.url.lower() or "checkpoint" in response.url.lower():
            return {"status": "valid", "reason": "Redirected to login (profile exists but restricted)"}

        else:
            return {
                "status": "uncertain",
                "reason": f"Unexpected status code: {status_code}"
            }
    except requests.exceptions.RequestException as e:
        return {"status": "error", "reason": str(e)}


def search_people(organization_id, job_id):
    contacts = []
    page = 1

    logger.info(
        "apollo search_people start job_id=%s organization_id=%s",
        job_id,
        organization_id,
    )

    while True:
        payload = {
            "api_key": settings.apollo_api_key,
            "organization_ids": [organization_id],
            "person_titles": ["editor", "correspondent", "journalist"],
            "page": page,
            "per_page": 10
        }

        r = requests.post(f"{settings.apollo_base_url}/mixed_people/api_search", json=payload)

        try:
            data = r.json()
        except json.JSONDecodeError as e:
            logger.warning(
                "apollo api_search invalid json job_id=%s org=%s page=%s err=%s body_preview=%s",
                job_id,
                organization_id,
                page,
                e,
                (r.text or "")[:500],
            )
            break

        people = data.get("people", [])

        if not people:
            logger.info(
                "apollo search_people no more people job_id=%s org=%s last_page=%s total_contacts=%s",
                job_id,
                organization_id,
                page - 1,
                len(contacts),
            )
            break

        logger.info(
            "apollo api_search page job_id=%s org=%s page=%s people=%s",
            job_id,
            organization_id,
            page,
            len(people),
        )

        exclude_titles = ["data", "business", "advertising", "marketing"]
        payload = {
            "api_key": settings.apollo_api_key,
            "details": [{"id": person["id"]} for person in people if not any(word in (person.get("title") or "").lower() for word in exclude_titles)],
            "reveal_personal_emails": True
        }

        response = requests.post(f"{settings.apollo_base_url}/people/bulk_match", json=payload)
        bulk_json = response.json()
        enriched_people = bulk_json.get("matches") or []
        if not enriched_people and bulk_json:
            logger.warning(
                "apollo bulk_match empty matches job_id=%s org=%s page=%s keys=%s",
                job_id,
                organization_id,
                page,
                list(bulk_json.keys()),
            )
        for person in enriched_people:
            org = person.get("organization", {})
            data = {
                "contact_id":person.get("id"),
                "job_id": job_id,
                "organization_id": org.get("id"),
                "firm_name": org.get("name"),
                "firm_website_url": org.get("website_url"),
                "first_name": person.get("first_name"),
                "last_name": person.get("last_name"),
                "linkedin_profile": person.get("linkedin_url"),
                "linkedin_validation": check_linkedin_profile(person.get("linkedin_url")).get("status"),
                "person_title": person.get("title"),
                "official_email": person.get("email"),
                "official_email_status": person.get("email_status"),
                "personal_emails": person.get("personal_emails", []),
                "industry": "",
                "research_coverage": "",
                "geo": person.get("formatted_address") or f"{person.get('city','')}, {person.get('country','')}",
                "analyst_firm_hq": f"{org.get('city','')}, {org.get('country','')}"
                }
            contacts.append(data)
        page += 1
        time.sleep(2)

    logger.info(
        "apollo search_people done job_id=%s org=%s total_contacts=%s",
        job_id,
        organization_id,
        len(contacts),
    )
    return contacts


def _lyzr_post_with_retry(
    url: str,
    *,
    headers: dict,
    json_body: dict,
    timeout: float,
    job_id: str,
    label: str,
) -> requests.Response:
    """POST to Lyzr with retries on slow reads, connection delays, and transient 5xx."""
    attempts = max(1, settings.lyzr_http_retries)
    backoff = settings.lyzr_http_retry_backoff_seconds
    last_exc: BaseException | None = None

    for attempt in range(1, attempts + 1):
        try:
            r = requests.post(url, headers=headers, json=json_body, timeout=timeout)
            r.raise_for_status()
            return r
        except (
            requests.exceptions.ReadTimeout,
            requests.exceptions.ConnectTimeout,
        ) as e:
            last_exc = e
            logger.warning(
                "lyzr %s timeout job_id=%s attempt=%s/%s err=%s",
                label,
                job_id,
                attempt,
                attempts,
                e,
            )
        except requests.exceptions.HTTPError as e:
            code = e.response.status_code if e.response is not None else None
            if code in (502, 503, 504) and attempt < attempts:
                last_exc = e
                logger.warning(
                    "lyzr %s http %s job_id=%s attempt=%s/%s",
                    label,
                    code,
                    job_id,
                    attempt,
                    attempts,
                )
            else:
                raise
        if attempt < attempts:
            time.sleep(backoff * attempt)

    assert last_exc is not None
    raise last_exc


def _lyzr_stage1_post_until_valid_json(
    *,
    url: str,
    headers: dict,
    payload: dict,
    timeout: float,
    job_id: str,
    log_label: str,
) -> dict:
    """POST stage-1; on invalid JSON in `response`, re-run the batch (same contacts).

    Each HTTP attempt uses a new ``session_id`` so internal parse retries and a second
    top-level call (e.g. ``stage1_research_domain_retry``) never reuse a stale id from
    a previous successful round or prior invocation on the same ``payload`` dict.
    """
    max_parse_rounds = max(1, settings.lyzr_http_retries)
    backoff = settings.lyzr_http_retry_backoff_seconds
    agent_id = settings.lyzr_agent_research_domain_id
    last_err: BaseException | None = None

    for round_i in range(1, max_parse_rounds + 1):
        if round_i > 1:
            time.sleep(backoff * (round_i - 1))
        payload["session_id"] = f"{agent_id}-{uuid.uuid4().hex[:12]}"
        response = _lyzr_post_with_retry(
            url,
            headers=headers,
            json_body=payload,
            timeout=timeout,
            job_id=job_id,
            label=log_label if round_i == 1 else f"{log_label}_json_retry_{round_i}",
        )
        body = response.json()
        raw = body.get("response")
        try:
            if isinstance(raw, dict):
                return raw
            if not isinstance(raw, str):
                raise ValueError(f"unexpected response type {type(raw).__name__}")
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError("top-level JSON must be an object")
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            logger.warning(
                "lyzr stage1 parse failed job_id=%s label=%s round=%s/%s err=%s",
                job_id,
                log_label,
                round_i,
                max_parse_rounds,
                e,
            )
    assert last_err is not None
    raise last_err


def _process_lyzr_batch_for_job(job_id: str, batch: list) -> None:
    """Stage 2: two Lyzr agent calls for up to 5 contacts, then merge and update Mongo."""
    timeout = settings.lyzr_http_timeout_seconds
    LYZR_INFERENCE_URL = settings.lyzr_inference_url
    cids = [c.get("contact_id") for c in batch]
    logger.info(
        "lyzr batch start job_id=%s batch_size=%s contact_ids=%s",
        job_id,
        len(batch),
        cids,
    )

    lyzr_headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.lyzr_api_key,
    }

    stage1_contacts = []
    for contact in batch:
        stage1_contacts.append(
            {
                "contact_id": contact.get("contact_id",""),
                "firm_name": contact.get("firm_name",""),
                "firm_website_url": contact.get("firm_website_url",""),
                "first_name": contact.get("first_name",""),
                "last_name": contact.get("last_name",""),
                "linkedin_profile": contact.get("linkedin_profile",""),
                "person_title": contact.get("person_title",""),
                "official_email": contact.get("official_email",""),
            }
        )

    payload = {
        "user_id": settings.lyzr_user_id,
        "agent_id": settings.lyzr_agent_research_domain_id,
        "session_id": f"{settings.lyzr_agent_research_domain_id}-{uuid.uuid4().hex[:12]}",
        "message": json.dumps(stage1_contacts),
    }

    stage_result = _lyzr_stage1_post_until_valid_json(
        url=LYZR_INFERENCE_URL,
        headers=lyzr_headers,
        payload=payload,
        timeout=timeout,
        job_id=job_id,
        log_label="stage1_research_domain",
    )

    if stage_result["records"] == [] or False in [False for record in stage_result["records"] if not record.get("research_coverage")]:
        stage_result = _lyzr_stage1_post_until_valid_json(
            url=LYZR_INFERENCE_URL,
            headers=lyzr_headers,
            payload=payload,
            timeout=timeout,
            job_id=job_id,
            log_label="stage1_research_domain_retry",
        )

    stage1_records = stage_result.get("records", []) if isinstance(stage_result, dict) else []

        
    collection = get_collection("contacts")
    for contact in stage1_records:
        collection.find_one_and_update(
            {"contact_id": contact["contact_id"], "job_id": job_id},
            {
                "$set": {
                    "research_coverage": contact["research_coverage"],
                    "industry": contact["mapped_industries"],
                }
            },
        )

    logger.info(
        "lyzr batch done job_id=%s updated_records=%s",
        job_id,
        len(stage1_records),
    )


def run_lyzr_batches_and_complete_job(job_id: str, owner_user_id: str, contacts: list) -> None:
    """Run Lyzr in batches of up to 5 contacts (threaded), then set job status to completed."""
    batches = [contacts[i : i + 5] for i in range(0, len(contacts), 5)]
    logger.info(
        "enrichment lyzr batches job_id=%s batch_count=%s concurrency=%s",
        job_id,
        len(batches),
        min(settings.lyzr_batch_concurrency, len(batches)) if batches else 0,
    )
    if batches:
        workers = min(settings.lyzr_batch_concurrency, len(batches))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(lambda b: _process_lyzr_batch_for_job(job_id, b), batches))

    try:
        jobs = get_collection("jobs")
        jobs.find_one_and_update(
            {"_id": ObjectId(job_id), "owner_user_id": owner_user_id},
            {"$set": {"status": "completed", "updatedAt": datetime.now(timezone.utc).isoformat()}},
            return_document=False,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update job for total contacts found: {str(e)}",
        ) from e
    logger.info("enrichment task completed job_id=%s contacts=%s", job_id, len(contacts))


def _persist_job_failure(job_id: str, owner_user_id: str, message: str) -> None:
    try:
        jobs = get_collection("jobs")
        jobs.find_one_and_update(
            {"_id": ObjectId(job_id), "owner_user_id": owner_user_id},
            {
                "$set": {
                    "status": "failed",
                    "error": message,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            },
            return_document=False,
        )
    except Exception:
        logger.exception("failed to persist job failure status job_id=%s", job_id)


#----------------------------------Enrichment Task----------------------------------
def run_enrichment_task(job_id, owner_user_id, body):
    row_count = len(body.get("rows", []))
    logger.info(
        "enrichment task start job_id=%s owner_user_id=%s row_count=%s",
        job_id,
        owner_user_id,
        row_count,
    )
    try:
        _run_enrichment_task(job_id, owner_user_id, body)
    except Exception as e:
        logger.exception(
            "enrichment task failed job_id=%s owner_user_id=%s error=%s",
            job_id,
            owner_user_id,
            e,
        )
        _persist_job_failure(job_id, owner_user_id, str(e))


def _remove_duplicate_people(people: list) -> list:
    """Remove duplicate people from the list based on their contact_id."""
    return [p for i, p in enumerate(people) if p not in people[i + 1:]]


def _run_enrichment_task(job_id, owner_user_id, body):
    try:
        firms = [url.get("website") for url in body["rows"]]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    orgs = get_organizations_batch(job_id, owner_user_id, firms)
    logger.info(
        "enrichment orgs loaded job_id=%s org_count=%s",
        job_id,
        len(orgs),
    )

    contacts_enriched = []
    for idx, org in enumerate(orgs):
        logger.info(
            "enrichment search_people org job_id=%s index=%s/%s org_id=%s",
            job_id,
            idx + 1,
            len(orgs),
            org.get("id"),
        )

        people = search_people(org["id"], job_id)
        # Remove all the duplicate persons from the list
        filtered_people = _remove_duplicate_people(people)
        contacts_enriched.extend(filtered_people)

    logger.info(
        "enrichment contacts collected job_id=%s total=%s",
        job_id,
        len(contacts_enriched),
    )

    try:
        if contacts_enriched:
            get_collection("contacts").insert_many(contacts_enriched)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to insert contacts: {str(e)}") from e
    try:
        jobs = get_collection("jobs")
        jobs.find_one_and_update(
            {"_id": ObjectId(job_id), "owner_user_id": owner_user_id},
            {"$set": {"total_contacts_enriched": len(contacts_enriched), "status": "AI Enrichment"}},
            return_document=False
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job for total contacts found: {str(e)}") from e

    run_lyzr_batches_and_complete_job(job_id, owner_user_id, contacts_enriched)