import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import bcrypt
import jwt

try:
    from .config import get_settings
except ImportError:  # pragma: no cover - fallback for direct script execution
    from config import get_settings


JWT_ALGO = get_settings()["jwt_algo"]
JWT_EXPIRY_DAYS = get_settings()["jwt_expiry_days"]
JWT_SECRET = get_settings()["jwt_secret"]
COOKIE_NAME = get_settings()["cookie_name"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_token(username: str) -> str:
    payload: Dict[str, Any] = {
        "sub": username,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])


def get_cookie_settings() -> Dict[str, Any]:
    is_production = os.getenv("ENV", "").lower() == "production"
    return {
        "httponly": True,
        "secure": is_production,
        "samesite": "lax",
        "path": "/",
    }
