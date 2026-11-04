"""库存总览、预警、流水与补货接口。"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession, PageParams
from app.schemas.common import Page
from app.schemas.inventory import (
    InventoryAlertItem,
    InventoryItem,
    InventorySummary,
    ReplenishmentRequest,
    ReplenishmentResult,
    TransactionOut,
)
from app.services import inventory_service

router = APIRouter(prefix="/inventory", tags=["库存管理"])


@router.get("", response_model=Page[InventoryItem], summary="库存总览")
def inventory_overview(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="商品名称或编码")] = None,
    category: Annotated[str | None, Query(description="商品分类")] = None,
    stock_status: Annotated[
        str | None, Query(alias="status", description="normal / low / out_of_stock")
    ] = None,
    warehouse_id: Annotated[str | None, Query(description="只看某个仓库")] = None,
) -> Page[InventoryItem]:
    items, total = inventory_service.inventory_overview(
        db,
        keyword=keyword,
        category=category,
        status=stock_status,
        warehouse_id=warehouse_id,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[InventoryItem].build(items, total, paging.page, paging.page_size)


@router.get("/summary", response_model=InventorySummary, summary="库存汇总")
def inventory_summary(db: DbSession, _current: CurrentUser) -> InventorySummary:
    return inventory_service.inventory_summary(db)


@router.get("/alerts", response_model=Page[InventoryAlertItem], summary="库存预警")
def inventory_alerts(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="商品名称或编码")] = None,
    category: Annotated[str | None, Query(description="商品分类")] = None,
) -> Page[InventoryAlertItem]:
    items, total = inventory_service.inventory_alerts(
        db,
        keyword=keyword,
        category=category,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[InventoryAlertItem].build(items, total, paging.page, paging.page_size)


@router.get("/transactions", response_model=Page[TransactionOut], summary="库存流水")
def list_transactions(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    product_id: Annotated[str | None, Query(description="商品ID")] = None,
    warehouse_id: Annotated[str | None, Query(description="仓库ID")] = None,
    tx_type: Annotated[
        str | None,
        Query(alias="type", description="purchase_in / transfer_in / transfer_out"),
    ] = None,
    ref_code: Annotated[str | None, Query(description="来源单号")] = None,
    start_date: Annotated[date | None, Query(description="开始日期")] = None,
    end_date: Annotated[date | None, Query(description="结束日期")] = None,
) -> Page[TransactionOut]:
    items, total = inventory_service.list_transactions(
        db,
        product_id=product_id,
        warehouse_id=warehouse_id,
        tx_type=tx_type,
        ref_code=ref_code,
        start_date=start_date,
        end_date=end_date,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[TransactionOut].build(items, total, paging.page, paging.page_size)


@router.get(
    "/replenishment/{product_id}",
    response_model=ReplenishmentResult,
    summary="单个商品的补货测算",
)
def replenishment(product_id: str, db: DbSession, _current: CurrentUser) -> ReplenishmentResult:
    return inventory_service.replenishment_for_product(db, product_id)


@router.post(
    "/replenishment",
    response_model=ReplenishmentResult,
    summary="按请求体测算补货量",
)
def replenishment_post(
    payload: ReplenishmentRequest, db: DbSession, _current: CurrentUser
) -> ReplenishmentResult:
    return inventory_service.replenishment_for_product(db, payload.product_id)
