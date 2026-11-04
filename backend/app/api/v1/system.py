"""系统设置接口：参数配置与操作日志。"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import DbSession, GmUser, PageParams
from app.schemas.common import Page
from app.schemas.system import SystemConfigCreate, SystemConfigOut, SystemConfigUpdate
from app.schemas.user import OperationLogOut
from app.services import system_service

router = APIRouter(prefix="/system", tags=["系统设置"])


@router.get("/configs", response_model=list[SystemConfigOut], summary="参数配置列表")
def list_configs(db: DbSession, _current: GmUser) -> list[SystemConfigOut]:
    return system_service.list_configs(db)


@router.post(
    "/configs",
    response_model=SystemConfigOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增参数配置",
)
def create_config(
    payload: SystemConfigCreate, db: DbSession, current_user: GmUser
) -> SystemConfigOut:
    config = system_service.create_config(db, payload, user=current_user)
    db.commit()
    db.refresh(config)
    return system_service.config_to_out(config)


@router.put("/configs/{config_id}", response_model=SystemConfigOut, summary="修改参数配置")
def update_config(
    config_id: str, payload: SystemConfigUpdate, db: DbSession, current_user: GmUser
) -> SystemConfigOut:
    config = system_service.update_config(db, config_id, payload, user=current_user)
    db.commit()
    db.refresh(config)
    return system_service.config_to_out(config)


@router.get(
    "/operation-logs", response_model=Page[OperationLogOut], summary="操作日志"
)
def list_operation_logs(
    db: DbSession,
    _current: GmUser,
    paging: PageParams,
    username: Annotated[str | None, Query(description="操作人账号")] = None,
    module: Annotated[str | None, Query(description="模块")] = None,
    action: Annotated[str | None, Query(description="动作")] = None,
    start_date: Annotated[date | None, Query(description="开始日期")] = None,
    end_date: Annotated[date | None, Query(description="结束日期")] = None,
) -> Page[OperationLogOut]:
    items, total = system_service.list_operation_logs(
        db,
        username=username,
        module=module,
        action=action,
        start_date=start_date,
        end_date=end_date,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[OperationLogOut].build(items, total, paging.page, paging.page_size)
