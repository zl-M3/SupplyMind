"""登录认证接口。"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.security import create_access_token
from app.schemas.common import MessageOut
from app.schemas.user import (
    ChangePasswordRequest,
    LoginRequest,
    TokenResponse,
    UserOut,
)
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="账号密码登录",
)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    user = user_service.authenticate(db, payload.username, payload.password)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.username, role=user.role)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user_service.user_to_out(user),
    )


@router.get("/me", response_model=UserOut, summary="获取当前登录用户")
def me(current_user: CurrentUser) -> UserOut:
    return user_service.user_to_out(current_user)


@router.post("/password", response_model=MessageOut, summary="修改自己的密码")
def change_password(
    payload: ChangePasswordRequest, current_user: CurrentUser, db: DbSession
) -> MessageOut:
    user_service.change_password(db, current_user, payload)
    db.commit()
    return MessageOut(message="密码已更新，请使用新密码重新登录")


@router.post("/logout", response_model=MessageOut, summary="退出登录（前端清理令牌）")
def logout(current_user: CurrentUser) -> MessageOut:
    return MessageOut(message=f"{current_user.display_name} 已退出登录")
