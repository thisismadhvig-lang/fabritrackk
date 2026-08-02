from typing import Any, Dict, Generator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

try:
    from backend.database import SessionLocal
    from backend.models import UserORM
    from backend.server import _serialize_row
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script execution
    from database import SessionLocal
    from models import UserORM
    from server import _serialize_row

from .security import decode_token


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    token = request.cookies.get("loomline_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(UserORM).filter(UserORM.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    user_payload = _serialize_row(UserORM, user)
    user_payload.pop("password_hash", None)
    return user_payload
