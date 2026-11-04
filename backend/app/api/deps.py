"""接口公共依赖：数据库会话、当前登录用户、角色校验与分页。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AuthError, PermissionDeniedError
from app.core.security import decode_access_token
from app.models import User
from app.models.enums import AccountStatus, UserRole

bearer_scheme = HTTPBearer(auto_error=False, description="Bearer Token（登录接口返回）")

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthError("请先登录")
    payload = decode_access_token(credentials.credentials)
    username = payload.get("sub")
    if not username:
        raise AuthError("登录状态无效，请重新登录", code="TOKEN_INVALID")

    user = db.get(User, username)
    if user is None:
        raise AuthError("账号不存在或已被删除", code="USER_NOT_FOUND")
    if user.status != AccountStatus.ENABLED.value:
        raise AuthError("账号已停用，请联系管理员", code="ACCOUNT_DISABLED")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole):
    """生成一个只允许指定角色访问的依赖。"""

    allowed = {role.value for role in roles}

    def _dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            labels = "、".join(role.value for role in roles)
            raise PermissionDeniedError(f"当前角色无权执行该操作（需要 {labels}）")
        return user

    return _dependency


GmUser = Annotated[User, Depends(require_roles(UserRole.GM))]


class Pagination:
    def __init__(
        self,
        page: int = Query(default=1, ge=1, description="页码，从 1 开始"),
        page_size: int = Query(default=20, ge=1, le=200, description="每页条数"),
    ) -> None:
        self.page = page
        self.page_size = page_size


PageParams = Annotated[Pagination, Depends()]


__all__ = [
    "CurrentUser",
    "DbSession",
    "GmUser",
    "PageParams",
    "Pagination",
    "bearer_scheme",
    "get_current_user",
    "require_roles",
]
