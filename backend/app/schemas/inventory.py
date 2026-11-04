"""库存总览、预警、流水与补货的出入参。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class WarehouseStockItem(BaseModel):
    warehouse_id: str
    warehouse_code: str = ""
    warehouse_name: str = ""
    qty: int = 0


class WarehouseStockRow(BaseModel):
    """某仓库下的商品结存明细。"""

    warehouse_id: str
    warehouse_code: str = ""
    warehouse_name: str = ""
    product_id: str
    product_code: str
    product_name: str
    category: str | None = None
    spec: str | None = None
    unit: str | None = None
    safety_stock: int = 0
    qty: int = 0
    status: str = "normal"
    status_label: str = "正常"


class InventoryItem(BaseModel):
    product_id: str
    product_code: str
    product_name: str
    category: str | None = None
    spec: str | None = None
    unit: str | None = None
    safety_stock: int = 0
    purchase_price: Decimal | None = None
    total_qty: int = 0
    status: str
    status_label: str
    gap: int = 0
    warehouses: list[WarehouseStockItem] = Field(default_factory=list)


class InventoryAlertItem(BaseModel):
    product_id: str
    product_code: str
    product_name: str
    category: str | None = None
    unit: str | None = None
    current_qty: int = 0
    safety_stock: int = 0
    shortage: int = 0
    status: str
    status_label: str
    suggested_action: str


class InventorySummary(BaseModel):
    total_sku: int = 0
    total_qty: int = 0
    normal_count: int = 0
    low_count: int = 0
    out_of_stock_count: int = 0
    total_value: Decimal = Decimal("0")


class TransactionOut(BaseModel):
    id: str
    type: str
    type_label: str
    product_id: str
    product_name: str | None = None
    warehouse_id: str
    warehouse_name: str | None = None
    qty: int
    before_qty: int | None = None
    after_qty: int | None = None
    ref_code: str | None = None
    operator: str | None = None
    remark: str | None = None
    created_at: datetime


class ReplenishmentRequest(BaseModel):
    product_id: str = Field(min_length=1)


class ReplenishmentResult(BaseModel):
    product_id: str
    product_code: str
    product_name: str
    unit: str | None = None
    safety_stock: int = 0
    current_qty: int = 0
    incoming_qty: int = 0
    suggested_qty: int = 0
    formula: str = ""
    explanation: str = ""
    evidence: list[str] = Field(default_factory=list)
    reference_supplier_id: str | None = None
    reference_supplier_name: str | None = None
    reference_price: Decimal | None = None
    estimated_amount: Decimal | None = None
    calculated_at: datetime
