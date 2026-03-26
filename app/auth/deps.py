from fastapi import Header, HTTPException
from bson import ObjectId
from app.auth.security import decode_access_token
from app.db.mongo import get_collection


def _extract_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ")
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return authorization


def get_current_user(authorization: str | None = Header(default=None)):
    token = _extract_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    users = get_collection("users")
    user = users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
