"""采购订单接口。"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, GmUser, PageParams
from app.core.errors import NotFoundError
from app.models.enums import PurchaseOrderStatus
from app.schemas.common import Page, StatusOption
from app.schemas.purchase import (
    CancelRequest,
    PurchaseOrderCreate,
    PurchaseOrderOut,
    PurchaseOrderUpdate,
    ReceiptCreate,
    ReceiptOut,
    RejectRequest,
)
from app.services import purchase_service

router = APIRouter(prefix="/purchase-orders", tags=["采购订单"])


@router.get("", response_model=Page[PurchaseOrderOut], summary="采购订单列表")
def list_orders(
    db: DbSession,
    current_user: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="单号或备注关键词")] = None,
    supplier_id: Annotated[str | None, Query(description="供应商ID")] = None,
    order_status: Annotated[
        str | None,
        Query(
            alias="status",
            description="draft / pending / approved / partial / completed / rejected / cancelled",
        ),
    ] = None,
    created_by: Annotated[str | None, Query(description="创建人账号")] = None,
    mine: Annotated[bool, Query(description="只看我创建的")] = False,
    start_date: Annotated[date | None, Query(description="创建开始日期")] = None,
    end_date: Annotated[date | None, Query(description="创建结束日期")] = None,
) -> Page[PurchaseOrderOut]:
    if mine and not created_by:
        created_by = current_user.username
    items, total = purchase_service.list_orders(
        db,
        keyword=keyword,
        supplier_id=supplier_id,
        status=order_status,
        created_by=created_by,
        start_date=start_date,
        end_date=end_date,
        page=paging.page,
        page_size=paging.page_size,
        user=current_user,
    )
    return Page[PurchaseOrderOut].build(items, total, paging.page, paging.page_size)


@router.get("/status-options", response_model=list[StatusOption], summary="采购单状态字典")
def status_options(_current: CurrentUser) -> list[StatusOption]:
    return [StatusOption(value=item.value, label=item.label) for item in PurchaseOrderStatus]


@router.post(
    "",
    response_model=PurchaseOrderOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建采购订单（草稿）",
)
def create_order(
    payload: PurchaseOrderCreate, db: DbSession, current_user: CurrentUser
) -> PurchaseOrderOut:
    order = purchase_service.create_order(db, payload, user=current_user)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.get("/{order_id}", response_model=PurchaseOrderOut, summary="采购订单详情")
def get_order(order_id: str, db: DbSession, current_user: CurrentUser) -> PurchaseOrderOut:
    order = purchase_service.get_order(db, order_id)
    return purchase_service.order_to_out(order, current_user)


@router.put("/{order_id}", response_model=PurchaseOrderOut, summary="修改采购订单（仅草稿）")
def update_order(
    order_id: str, payload: PurchaseOrderUpdate, db: DbSession, current_user: CurrentUser
) -> PurchaseOrderOut:
    order = purchase_service.update_order(db, order_id, payload, user=current_user)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.post("/{order_id}/submit", response_model=PurchaseOrderOut, summary="提交审批")
def submit_order(order_id: str, db: DbSession, current_user: CurrentUser) -> PurchaseOrderOut:
    order = purchase_service.submit_order(db, order_id, user=current_user)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.post("/{order_id}/approve", response_model=PurchaseOrderOut, summary="审批通过")
def approve_order(
    order_id: str,
    db: DbSession,
    current_user: GmUser,
    note: Annotated[str | None, Query(description="审批备注")] = None,
) -> PurchaseOrderOut:
    order = purchase_service.approve_order(db, order_id, user=current_user, note=note)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.post("/{order_id}/reject", response_model=PurchaseOrderOut, summary="审批驳回")
def reject_order(
    order_id: str, payload: RejectRequest, db: DbSession, current_user: GmUser
) -> PurchaseOrderOut:
    order = purchase_service.reject_order(db, order_id, user=current_user, reason=payload.reason)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.post("/{order_id}/cancel", response_model=PurchaseOrderOut, summary="取消采购订单")
def cancel_order(
    order_id: str,
    db: DbSession,
    current_user: CurrentUser,
    payload: CancelRequest | None = None,
) -> PurchaseOrderOut:
    reason = payload.reason if payload else None
    order = purchase_service.cancel_order(db, order_id, user=current_user, reason=reason)
    db.commit()
    db.refresh(order)
    return purchase_service.order_to_out(order, current_user)


@router.post("/{order_id}/receive", response_model=ReceiptOut, summary="收货入库")
def receive_order(
    order_id: str, payload: ReceiptCreate, db: DbSession, current_user: CurrentUser
) -> ReceiptOut:
    receipt = purchase_service.receive_order(db, order_id, payload, user=current_user)
    receipt_id = receipt.id
    db.commit()
    receipts = purchase_service.list_receipts(db, order_id)
    for item in receipts:
        if item.id == receipt_id:
            return item
    raise NotFoundError("收货记录写入后未能读回，请刷新后重试")


@router.get("/{order_id}/receipts", response_model=list[ReceiptOut], summary="收货记录")
def list_receipts(order_id: str, db: DbSession, _current: CurrentUser) -> list[ReceiptOut]:
    return purchase_service.list_receipts(db, order_id)
