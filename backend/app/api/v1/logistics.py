"""物流跟踪接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, GmUser, PageParams
from app.models.enums import LogisticsStatus
from app.schemas.common import Page, StatusOption
from app.schemas.logistics import (
    DelayRefreshResult,
    LogisticsCreate,
    LogisticsEventCreate,
    LogisticsEventOut,
    LogisticsOut,
)
from app.services import logistics_service

router = APIRouter(prefix="/logistics", tags=["物流跟踪"])


@router.get("", response_model=Page[LogisticsOut], summary="物流单列表")
def list_logistics(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="物流单号、运单号或供应商")] = None,
    logistics_status: Annotated[
        str | None,
        Query(
            alias="status",
            description="pending / in_transit / arrived / delivered / exception",
        ),
    ] = None,
    only_delayed: Annotated[bool, Query(description="只看延迟的物流单")] = False,
    po_id: Annotated[str | None, Query(description="采购订单ID")] = None,
    supplier_id: Annotated[str | None, Query(description="供应商ID")] = None,
) -> Page[LogisticsOut]:
    items, total = logistics_service.list_logistics(
        db,
        keyword=keyword,
        status=logistics_status,
        only_delayed=only_delayed,
        po_id=po_id,
        supplier_id=supplier_id,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[LogisticsOut].build(items, total, paging.page, paging.page_size)


@router.get("/status-options", response_model=list[StatusOption], summary="物流状态字典")
def status_options(_current: CurrentUser) -> list[StatusOption]:
    return [StatusOption(value=item.value, label=item.label) for item in LogisticsStatus]


@router.post(
    "",
    response_model=LogisticsOut,
    status_code=status.HTTP_201_CREATED,
    summary="创建物流单",
)
def create_logistics(
    payload: LogisticsCreate, db: DbSession, current_user: GmUser
) -> LogisticsOut:
    order = logistics_service.create_logistics(db, payload, user=current_user)
    db.commit()
    db.refresh(order)
    return logistics_service.logistics_to_out(order)


@router.post("/refresh-delays", response_model=DelayRefreshResult, summary="刷新延迟状态")
def refresh_delays(db: DbSession, _current: CurrentUser) -> DelayRefreshResult:
    result = logistics_service.refresh_delays(db)
    db.commit()
    return result


@router.get("/{logistics_id}", response_model=LogisticsOut, summary="物流单详情")
def get_logistics(logistics_id: str, db: DbSession, _current: CurrentUser) -> LogisticsOut:
    order = logistics_service.get_logistics(db, logistics_id)
    return logistics_service.logistics_to_out(order)


@router.post(
    "/{logistics_id}/events",
    response_model=LogisticsEventOut,
    status_code=status.HTTP_201_CREATED,
    summary="追加物流节点（自动推进状态）",
)
def add_event(
    logistics_id: str, payload: LogisticsEventCreate, db: DbSession, current_user: CurrentUser
) -> LogisticsEventOut:
    event = logistics_service.add_event(db, logistics_id, payload, user=current_user)
    db.commit()
    db.refresh(event)
    return logistics_service.event_to_out(event)


@router.patch("/{logistics_id}/status", response_model=LogisticsOut, summary="手动修改物流状态")
def update_status(
    logistics_id: str,
    db: DbSession,
    current_user: GmUser,
    logistics_status: Annotated[str, Query(alias="status", description="目标状态")],
) -> LogisticsOut:
    order = logistics_service.update_status(
        db, logistics_id, logistics_status, user=current_user
    )
    db.commit()
    db.refresh(order)
    return logistics_service.logistics_to_out(order)
