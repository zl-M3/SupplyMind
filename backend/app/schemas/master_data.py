"""主数据（供应商 / 商品 / 仓库）的出入参。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import MasterStatus
from app.schemas.common import ORMModel


# --------------------------------------------------------------------------- #
# 供应商
# --------------------------------------------------------------------------- #
class SupplierCreate(BaseModel):
    code: str | None = Field(
        default=None,
        max_length=32,
        description="供应商编码；留空时由后端按 SUP001 规则自动生成",
    )
    name: str = Field(min_length=1, max_length=120)
    contact: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=32)
    categories: list[str] = Field(default_factory=list, description="供货品类")
    address: str | None = Field(default=None, max_length=200)
    status: MasterStatus = MasterStatus.ACTIVE
    remark: str | None = Field(default=None, max_length=500)


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    contact: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=32)
    categories: list[str] | None = None
    address: str | None = Field(default=None, max_length=200)
    status: MasterStatus | None = None
    remark: str | None = Field(default=None, max_length=500)


class SupplierOut(ORMModel):
    id: str
    code: str
    name: str
    contact: str | None = None
    phone: str | None = None
    categories: list[str] | None = None
    address: str | None = None
    status: str
    status_label: str = ""
    remark: str | None = None
    created_at: datetime


class SupplierStatistics(BaseModel):
    supplier_id: str
    supplier_name: str = ""
    total_orders: int = 0
    completed_orders: int = 0
    in_progress_orders: int = 0
    delayed_orders: int = 0
    sample_size: int = 0
    on_time_orders: int = 0
    on_time_rate: float | None = None
    has_enough_sample: bool = False
    total_purchase_amount: Decimal = Decimal("0")
    last_order_date: date | None = None
    note: str = ""


class SupplierDetail(SupplierOut):
    statistics: SupplierStatistics | None = None


# --------------------------------------------------------------------------- #
# 商品
# --------------------------------------------------------------------------- #
class ProductCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=40, description="商品大类")
    sub_category: str | None = Field(default=None, max_length=40, description="商品小类")
    spec: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=16)
    safety_stock: int = Field(default=0, ge=0)
    purchase_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    status: MasterStatus = MasterStatus.ACTIVE


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=40, description="商品大类")
    sub_category: str | None = Field(default=None, max_length=40, description="商品小类")
    spec: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=16)
    safety_stock: int | None = Field(default=None, ge=0)
    purchase_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    status: MasterStatus | None = None


class ProductOut(ORMModel):
    id: str
    code: str
    name: str
    category: str | None = None
    sub_category: str | None = None
    spec: str | None = None
    unit: str | None = None
    safety_stock: int
    purchase_price: Decimal | None = None
    status: str
    status_label: str = ""
    created_at: datetime
    total_qty: int = 0
    stock_status: str = "normal"
    stock_status_label: str = "正常"


# --------------------------------------------------------------------------- #
# 仓库
# --------------------------------------------------------------------------- #
class WarehouseCreate(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=200)
    manager: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=32)
    status: MasterStatus = MasterStatus.ACTIVE


class WarehouseUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=200)
    manager: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=32)
    status: MasterStatus | None = None


class WarehouseOut(ORMModel):
    id: str
    code: str
    name: str
    address: str | None = None
    manager: str | None = None
    phone: str | None = None
    status: str
    status_label: str = ""
    created_at: datetime
    total_qty: int = 0
    sku_count: int = 0
