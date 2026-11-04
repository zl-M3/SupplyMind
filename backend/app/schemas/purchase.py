"""采购订单与收货单的出入参。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel


class PurchaseOrderItemIn(BaseModel):
    product_id: str = Field(min_length=1)
    qty: int = Field(gt=0, description="采购数量")
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class PurchaseOrderItemOut(ORMModel):
    id: str
    product_id: str
    product_name: str | None = None
    spec: str | None = None
    unit: str | None = None
    qty: int
    received_qty: int
    remaining_qty: int = 0
    price: Decimal
    amount: Decimal


class PurchaseOrderCreate(BaseModel):
    supplier_id: str = Field(min_length=1)
    expected_arrival: date = Field(description="预计到货日期")
    remark: str | None = Field(default=None, max_length=500)
    items: list[PurchaseOrderItemIn] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def _unique_products(cls, items: list[PurchaseOrderItemIn]) -> list[PurchaseOrderItemIn]:
        ids = [item.product_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("同一商品不能重复出现在采购明细中")
        return items


class PurchaseOrderUpdate(BaseModel):
    supplier_id: str | None = None
    expected_arrival: date | None = None
    remark: str | None = Field(default=None, max_length=500)
    items: list[PurchaseOrderItemIn] | None = None

    @field_validator("items")
    @classmethod
    def _unique_products(cls, items: list[PurchaseOrderItemIn] | None):
        if items is None:
            return items
        ids = [item.product_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("同一商品不能重复出现在采购明细中")
        return items


class PurchaseOrderOut(ORMModel):
    id: str
    code: str
    supplier_id: str
    supplier_name: str | None = None
    status: str
    status_label: str = ""
    total_amount: Decimal
    created_by: str
    created_by_name: str | None = None
    created_at: datetime
    expected_arrival: date
    approver: str | None = None
    approver_name: str | None = None
    approved_at: datetime | None = None
    reject_reason: str | None = None
    remark: str | None = None
    logistics_id: str | None = None
    ordered_qty: int = 0
    received_qty: int = 0
    remaining_qty: int = 0
    can_approve: bool = False
    can_receive: bool = False
    items: list[PurchaseOrderItemOut] = Field(default_factory=list)


class PurchaseOrderBrief(ORMModel):
    id: str
    code: str
    supplier_name: str | None = None
    status: str
    status_label: str = ""
    total_amount: Decimal
    expected_arrival: date
    created_at: datetime


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class CancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ReceiptItemIn(BaseModel):
    po_item_id: str = Field(min_length=1)
    qty: int = Field(gt=0)


class ReceiptCreate(BaseModel):
    warehouse_id: str = Field(min_length=1)
    items: list[ReceiptItemIn] = Field(min_length=1)
    remark: str | None = Field(default=None, max_length=300)

    @field_validator("items")
    @classmethod
    def _unique_items(cls, items: list[ReceiptItemIn]) -> list[ReceiptItemIn]:
        ids = [item.po_item_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("同一条采购明细不能重复收货")
        return items


class ReceiptItemOut(ORMModel):
    id: int
    po_item_id: str
    qty: int
    product_id: str | None = None
    product_name: str | None = None


class ReceiptOut(ORMModel):
    id: str
    code: str
    po_id: str
    warehouse_id: str
    warehouse_name: str | None = None
    received_by: str
    received_at: datetime
    remark: str | None = None
    items: list[ReceiptItemOut] = Field(default_factory=list)
