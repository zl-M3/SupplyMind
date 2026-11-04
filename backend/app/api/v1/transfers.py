"""库存调拨接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, PageParams
from app.schemas.common import Page
from app.schemas.transfer import StockTransferCreate, StockTransferOut
from app.services import transfer_service

router = APIRouter(prefix="/stock-transfers", tags=["库存调拨"])


@router.get("", response_model=Page[StockTransferOut], summary="调拨记录列表")
def list_transfers(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    warehouse_id: Annotated[str | None, Query(description="调出或调入仓库ID")] = None,
) -> Page[StockTransferOut]:
    items, total = transfer_service.list_transfers(
        db, warehouse_id=warehouse_id, page=paging.page, page_size=paging.page_size
    )
    return Page[StockTransferOut].build(items, total, paging.page, paging.page_size)


@router.post(
    "",
    response_model=StockTransferOut,
    status_code=status.HTTP_201_CREATED,
    summary="发起调拨（单商品，一次性扣减并增加库存）",
)
def create_transfer(
    payload: StockTransferCreate, db: DbSession, current_user: CurrentUser
) -> StockTransferOut:
    transfer = transfer_service.create_transfer(db, payload, user=current_user)
    db.commit()
    db.refresh(transfer)
    return transfer_service.transfer_to_out(transfer)


@router.get("/{transfer_id}", response_model=StockTransferOut, summary="调拨单详情")
def get_transfer(transfer_id: str, db: DbSession, _current: CurrentUser) -> StockTransferOut:
    transfer = transfer_service.get_transfer(db, transfer_id)
    return transfer_service.transfer_to_out(transfer)
