"""账号管理接口（仅 GM 可维护）。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, GmUser, PageParams
from app.schemas.common import MessageOut, Page
from app.schemas.user import (
    OperationLogOut,
    ResetPasswordRequest,
    RoleOption,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import system_service, user_service

router = APIRouter(prefix="/users", tags=["账号管理"])


@router.get("", response_model=Page[UserOut], summary="账号列表")
def list_users(
    db: DbSession,
    _current: GmUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="账号或姓名关键词")] = None,
    role: Annotated[str | None, Query(description="角色：GM / SALES")] = None,
    account_status: Annotated[int | None, Query(alias="status", ge=0, le=1, description="0 停用 / 1 启用")] = None,
) -> Page[UserOut]:
    items, total = user_service.list_users(
        db,
        keyword=keyword,
        role=role,
        status=account_status,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[UserOut].build(items, total, paging.page, paging.page_size)


@router.get("/roles", response_model=list[RoleOption], summary="角色选项")
def role_options(_current: CurrentUser) -> list[RoleOption]:
    return user_service.role_options()


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建账号",
)
def create_user(payload: UserCreate, db: DbSession, _current: GmUser) -> UserOut:
    user = user_service.create_user(db, payload)
    db.commit()
    db.refresh(user)
    return user_service.user_to_out(user)


@router.get("/{username}", response_model=UserOut, summary="账号详情")
def get_user(username: str, db: DbSession, _current: GmUser) -> UserOut:
    return user_service.user_to_out(user_service.get_user(db, username))


@router.put("/{username}", response_model=UserOut, summary="修改账号")
def update_user(
    username: str, payload: UserUpdate, db: DbSession, current_user: GmUser
) -> UserOut:
    user = user_service.update_user(db, username, payload, current_user=current_user)
    db.commit()
    db.refresh(user)
    return user_service.user_to_out(user)


@router.post(
    "/{username}/reset-password",
    response_model=MessageOut,
    summary="重置账号密码",
)
def reset_password(
    username: str, payload: ResetPasswordRequest, db: DbSession, _current: GmUser
) -> MessageOut:
    user_service.reset_password(db, username, payload.new_password)
    db.commit()
    return MessageOut(message=f"账号 {username} 的密码已重置")


@router.get(
    "/logs/operations",
    response_model=Page[OperationLogOut],
    summary="操作日志",
)
def list_operation_logs(
    db: DbSession,
    _current: GmUser,
    paging: PageParams,
    username: Annotated[str | None, Query(description="操作人")] = None,
    module: Annotated[str | None, Query(description="模块")] = None,
    action: Annotated[str | None, Query(description="动作")] = None,
) -> Page[OperationLogOut]:
    items, total = system_service.list_operation_logs(
        db,
        username=username,
        module=module,
        action=action,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[OperationLogOut].build(items, total, paging.page, paging.page_size)
