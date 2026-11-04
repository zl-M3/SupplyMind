"""商品与仓库接口（主数据维护）。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, GmUser, PageParams
from app.models.enums import MasterStatus
from app.schemas.common import Page, StatusOption
from app.schemas.inventory import TransactionOut, WarehouseStockRow
from app.schemas.master_data import (
    ProductCreate,
    ProductOut,
    ProductUpdate,
    WarehouseCreate,
    WarehouseOut,
    WarehouseUpdate,
)
from app.services import inventory_service, master_data_service

products_router = APIRouter(prefix="/products", tags=["商品管理"])
warehouses_router = APIRouter(prefix="/warehouses", tags=["仓库管理"])


# --------------------------------------------------------------------------- #
# 商品
# --------------------------------------------------------------------------- #
@products_router.get("", response_model=Page[ProductOut], summary="商品列表")
def list_products(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="名称或编码关键词")] = None,
    category: Annotated[str | None, Query(description="商品大类")] = None,
    sub_category: Annotated[str | None, Query(description="商品小类")] = None,
    product_status: Annotated[
        str | None, Query(alias="status", description="active / disabled")
    ] = None,
) -> Page[ProductOut]:
    items, total = master_data_service.list_products(
        db,
        keyword=keyword,
        category=category,
        sub_category=sub_category,
        status=product_status,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[ProductOut].build(items, total, paging.page, paging.page_size)


@products_router.get("/options", summary="商品下拉选项")
def product_options(db: DbSession, _current: CurrentUser) -> list[dict]:
    return master_data_service.product_options(db)


@products_router.get("/status-options", response_model=list[StatusOption], summary="商品状态字典")
def product_status_options(_current: CurrentUser) -> list[StatusOption]:
    return [StatusOption(value=item.value, label=item.label) for item in MasterStatus]


@products_router.post(
    "",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建商品",
)
def create_product(payload: ProductCreate, db: DbSession, _current: GmUser) -> ProductOut:
    product = master_data_service.create_product(db, payload)
    db.commit()
    db.refresh(product)
    return master_data_service.product_to_out(product)


@products_router.get("/{product_id}", response_model=ProductOut, summary="商品详情")
def get_product(product_id: str, db: DbSession, _current: CurrentUser) -> ProductOut:
    product = master_data_service.get_product(db, product_id)
    total = inventory_service.product_total_qty(db, product_id)
    return master_data_service.product_to_out(product, total_qty=total)


@products_router.put("/{product_id}", response_model=ProductOut, summary="修改商品")
def update_product(
    product_id: str, payload: ProductUpdate, db: DbSession, _current: GmUser
) -> ProductOut:
    product = master_data_service.update_product(db, product_id, payload)
    db.commit()
    db.refresh(product)
    total = inventory_service.product_total_qty(db, product_id)
    return master_data_service.product_to_out(product, total_qty=total)


@products_router.patch("/{product_id}/status", response_model=ProductOut, summary="启用 / 停用商品")
def set_product_status(
    product_id: str,
    db: DbSession,
    _current: GmUser,
    product_status: Annotated[str, Query(alias="status", description="active / disabled")],
) -> ProductOut:
    product = master_data_service.set_product_status(db, product_id, product_status)
    db.commit()
    db.refresh(product)
    total = inventory_service.product_total_qty(db, product_id)
    return master_data_service.product_to_out(product, total_qty=total)


@products_router.get("/{product_id}/inventory", summary="商品库存明细（按仓库）")
def product_inventory(product_id: str, db: DbSession, _current: CurrentUser) -> dict:
    return inventory_service.product_inventory_detail(db, product_id)


@products_router.get(
    "/{product_id}/transactions",
    response_model=Page[TransactionOut],
    summary="商品库存流水",
)
def product_transactions(
    product_id: str, db: DbSession, _current: CurrentUser, paging: PageParams
) -> Page[TransactionOut]:
    items, total = inventory_service.list_transactions(
        db, product_id=product_id, page=paging.page, page_size=paging.page_size
    )
    return Page[TransactionOut].build(items, total, paging.page, paging.page_size)


# --------------------------------------------------------------------------- #
# 仓库
# --------------------------------------------------------------------------- #
@warehouses_router.get("", response_model=Page[WarehouseOut], summary="仓库列表")
def list_warehouses(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="名称或编码关键词")] = None,
    warehouse_status: Annotated[
        str | None, Query(alias="status", description="active / disabled")
    ] = None,
) -> Page[WarehouseOut]:
    items, total = master_data_service.list_warehouses(
        db,
        keyword=keyword,
        status=warehouse_status,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[WarehouseOut].build(items, total, paging.page, paging.page_size)


@warehouses_router.get("/options", summary="仓库下拉选项")
def warehouse_options(db: DbSession, _current: CurrentUser) -> list[dict]:
    return master_data_service.warehouse_options(db)


@warehouses_router.get("/status-options", response_model=list[StatusOption], summary="仓库状态字典")
def warehouse_status_options(_current: CurrentUser) -> list[StatusOption]:
    return [StatusOption(value=item.value, label=item.label) for item in MasterStatus]


@warehouses_router.post(
    "",
    response_model=WarehouseOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建仓库",
)
def create_warehouse(payload: WarehouseCreate, db: DbSession, _current: GmUser) -> WarehouseOut:
    warehouse = master_data_service.create_warehouse(db, payload)
    db.commit()
    db.refresh(warehouse)
    return master_data_service.warehouse_to_out(warehouse)


@warehouses_router.get("/{warehouse_id}", response_model=WarehouseOut, summary="仓库详情")
def get_warehouse(warehouse_id: str, db: DbSession, _current: CurrentUser) -> WarehouseOut:
    warehouse = master_data_service.get_warehouse(db, warehouse_id)
    rows = inventory_service.warehouse_stock_list(db, warehouse_id)
    total_qty = sum(row.qty for row in rows)
    return master_data_service.warehouse_to_out(
        warehouse, total_qty=total_qty, sku_count=len(rows)
    )


@warehouses_router.put("/{warehouse_id}", response_model=WarehouseOut, summary="修改仓库")
def update_warehouse(
    warehouse_id: str, payload: WarehouseUpdate, db: DbSession, _current: GmUser
) -> WarehouseOut:
    warehouse = master_data_service.update_warehouse(db, warehouse_id, payload)
    db.commit()
    db.refresh(warehouse)
    rows = inventory_service.warehouse_stock_list(db, warehouse_id)
    return master_data_service.warehouse_to_out(
        warehouse, total_qty=sum(row.qty for row in rows), sku_count=len(rows)
    )


@warehouses_router.patch(
    "/{warehouse_id}/status", response_model=WarehouseOut, summary="启用 / 停用仓库"
)
def set_warehouse_status(
    warehouse_id: str,
    db: DbSession,
    _current: GmUser,
    warehouse_status: Annotated[str, Query(alias="status", description="active / disabled")],
) -> WarehouseOut:
    warehouse = master_data_service.set_warehouse_status(db, warehouse_id, warehouse_status)
    db.commit()
    db.refresh(warehouse)
    rows = inventory_service.warehouse_stock_list(db, warehouse_id)
    return master_data_service.warehouse_to_out(
        warehouse, total_qty=sum(row.qty for row in rows), sku_count=len(rows)
    )


@warehouses_router.get(
    "/{warehouse_id}/stock",
    response_model=list[WarehouseStockRow],
    summary="仓库库存明细",
)
def warehouse_stock(
    warehouse_id: str, db: DbSession, _current: CurrentUser
) -> list[WarehouseStockRow]:
    return inventory_service.warehouse_stock_list(db, warehouse_id)
