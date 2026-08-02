from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

try:
    from backend.core.dependencies import get_current_user
    from backend.core.security import COOKIE_NAME, create_token, get_cookie_settings, hash_password, verify_password
    from backend.database import SessionLocal
    from backend.models import UserORM
    from backend.server import _serialize_row
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script execution
    from core.dependencies import get_current_user
    from core.security import COOKIE_NAME, create_token, get_cookie_settings, hash_password, verify_password
    from database import SessionLocal
    from models import UserORM
    from server import _serialize_row

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginPayload(BaseModel):
    username: str
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


class ChangeUsernamePayload(BaseModel):
    new_username: str


@router.post("/login")
async def login(payload: LoginPayload, response: Response) -> Dict[str, Any]:
    with SessionLocal() as session:
        user = session.query(UserORM).filter(UserORM.username == payload.username).first()
        if not user or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(payload.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=30 * 24 * 60 * 60,
        **get_cookie_settings(),
    )

    return {"token": token, "user": _serialize_row(UserORM, user)}


@router.post("/logout")
async def logout(response: Response) -> Dict[str, str]:
    response.delete_cookie(key=COOKIE_NAME, **get_cookie_settings())
    return {"message": "Logged out"}


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return user


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordPayload,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with SessionLocal() as session:
        db_user = session.query(UserORM).filter(UserORM.username == user["username"]).first()
        if not db_user or not verify_password(payload.current_password, db_user.password_hash):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        db_user.password_hash = hash_password(payload.new_password)
        session.commit()

    return {"message": "Password updated"}


@router.post("/change-username")
async def change_username(
    payload: ChangeUsernamePayload,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    with SessionLocal() as session:
        existing = session.query(UserORM).filter(UserORM.username == payload.new_username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")

        db_user = session.query(UserORM).filter(UserORM.username == user["username"]).first()
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")

        db_user.username = payload.new_username
        session.commit()

    return {"message": "Username updated"}
