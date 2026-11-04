"""库存调拨的出入参（一条调拨单只调拨一个商品）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class StockTransferCreate(BaseModel):
    from_warehouse_id: str = Field(min_length=1, description="调出仓库")
    to_warehouse_id: str = Field(min_length=1, description="调入仓库")
    product_id: str = Field(min_length=1)
    qty: int = Field(gt=0, description="调拨数量")
    remark: str | None = Field(default=None, max_length=200)


class StockTransferOut(ORMModel):
    id: str
    code: str
    from_warehouse_id: str
    from_warehouse_name: str | None = None
    to_warehouse_id: str
    to_warehouse_name: str | None = None
    product_id: str
    product_name: str | None = None
    qty: int
    operator: str | None = None
    remark: str | None = None
    created_at: datetime
