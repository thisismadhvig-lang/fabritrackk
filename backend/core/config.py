import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

ROOT_DIR = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=1)
def get_settings() -> Dict[str, Any]:
    return {
        "root_dir": str(ROOT_DIR),
        "env": os.getenv("ENV", "development"),
        "jwt_secret": os.getenv("JWT_SECRET", "dev-secret"),
        "jwt_algo": os.getenv("JWT_ALGO", "HS256"),
        "jwt_expiry_days": int(os.getenv("JWT_EXPIRY_DAYS", "30")),
        "cookie_name": os.getenv("COOKIE_NAME", "loomline_token"),
        "backend_url": os.getenv("BACKEND_URL", "http://127.0.0.1:8000"),
    }
