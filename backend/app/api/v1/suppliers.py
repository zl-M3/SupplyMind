"""供应商接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, PageParams
from app.models.enums import MasterStatus
from app.schemas.common import Page, StatusOption
from app.schemas.master_data import (
    SupplierCreate,
    SupplierDetail,
    SupplierOut,
    SupplierStatistics,
    SupplierUpdate,
)
from app.services import master_data_service

router = APIRouter(prefix="/suppliers", tags=["供应商管理"])


@router.get("", response_model=Page[SupplierOut], summary="供应商列表")
def list_suppliers(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    keyword: Annotated[str | None, Query(description="名称、编码或联系人")] = None,
    supplier_status: Annotated[
        str | None, Query(alias="status", description="active / disabled")
    ] = None,
) -> Page[SupplierOut]:
    items, total = master_data_service.list_suppliers(
        db,
        keyword=keyword,
        status=supplier_status,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[SupplierOut].build(items, total, paging.page, paging.page_size)


@router.get("/options", summary="供应商下拉选项")
def supplier_options(db: DbSession, _current: CurrentUser) -> list[dict]:
    return master_data_service.supplier_options(db)


@router.get("/status-options", response_model=list[StatusOption], summary="供应商状态字典")
def status_options(_current: CurrentUser) -> list[StatusOption]:
    return [StatusOption(value=item.value, label=item.label) for item in MasterStatus]


@router.post(
    "",
    response_model=SupplierOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建供应商",
)
def create_supplier(payload: SupplierCreate, db: DbSession, _current: CurrentUser) -> SupplierOut:
    supplier = master_data_service.create_supplier(db, payload)
    db.commit()
    db.refresh(supplier)
    return master_data_service.supplier_to_out(supplier)


@router.get("/{supplier_id}", response_model=SupplierDetail, summary="供应商详情（含统计）")
def get_supplier(supplier_id: str, db: DbSession, _current: CurrentUser) -> SupplierDetail:
    return master_data_service.supplier_detail(db, supplier_id)


@router.put("/{supplier_id}", response_model=SupplierOut, summary="修改供应商")
def update_supplier(
    supplier_id: str, payload: SupplierUpdate, db: DbSession, _current: CurrentUser
) -> SupplierOut:
    supplier = master_data_service.update_supplier(db, supplier_id, payload)
    db.commit()
    db.refresh(supplier)
    return master_data_service.supplier_to_out(supplier)


@router.patch("/{supplier_id}/status", response_model=SupplierOut, summary="启用 / 停用供应商")
def set_supplier_status(
    supplier_id: str,
    db: DbSession,
    _current: CurrentUser,
    supplier_status: Annotated[str, Query(alias="status", description="active / disabled")],
) -> SupplierOut:
    supplier = master_data_service.set_supplier_status(db, supplier_id, supplier_status)
    db.commit()
    db.refresh(supplier)
    return master_data_service.supplier_to_out(supplier)


@router.get(
    "/{supplier_id}/statistics",
    response_model=SupplierStatistics,
    summary="供应商准时交付率",
)
def supplier_statistics(supplier_id: str, db: DbSession, _current: CurrentUser) -> SupplierStatistics:
    return master_data_service.supplier_statistics(db, supplier_id)
