from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.db.mongo import get_collection
from app.auth.security import hash_password, verify_password, create_access_token
from app.auth.deps import get_current_user
from app.utils import normalize_doc


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/register")
def register(body: RegisterBody):
    users = get_collection("users")
    if users.find_one({"email": body.email}):
        raise HTTPException(status_code=400, detail="Email already registered")

    user = {
        "email": body.email,
        "password_hash": hash_password(body.password),
        "name": body.name or "",
    }
    result = users.insert_one(user)
    token = create_access_token(str(result.inserted_id))
    created = users.find_one({"_id": result.inserted_id})
    return {"success": True, "token": token, "user": normalize_doc(created)}


@router.post("/login")
def login(body: LoginBody):
    users = get_collection("users")
    user = users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user["_id"]))
    return {"success": True, "token": token, "user": normalize_doc(user)}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return {"success": True, "user": normalize_doc(current_user)}


@router.post("/logout")
def logout():
    return {"success": True}
