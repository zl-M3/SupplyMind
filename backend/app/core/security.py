"""密码哈希与 JWT 令牌。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings
from app.core.errors import AuthError

# bcrypt 只处理前 72 字节
_BCRYPT_MAX_BYTES = 72


def _to_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_to_bytes(password), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(_to_bytes(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str | int, *, role: str | None = None, expires_minutes: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    expire_minutes = expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": now,
        "exp": now + timedelta(minutes=expire_minutes),
        "type": "access",
    }
    if role:
        payload["role"] = role
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError as exc:  # pragma: no cover - 依赖时钟
        raise AuthError("登录已过期，请重新登录", code="TOKEN_EXPIRED") from exc
    except jwt.PyJWTError as exc:
        raise AuthError("无效的访问令牌", code="TOKEN_INVALID") from exc
    if payload.get("type") != "access":
        raise AuthError("无效的访问令牌", code="TOKEN_INVALID")
    return payload
