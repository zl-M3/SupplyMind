"""物流单与轨迹节点的出入参。"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.enums import LogisticsStatus
from app.schemas.common import ORMModel


class LogisticsEventCreate(BaseModel):
    node: str = Field(min_length=1, max_length=40, description="节点名称，如「运输中」「清关中」")
    description: str = Field(min_length=1, max_length=300)
    location: str | None = Field(default=None, max_length=80)
    time: datetime | None = None


class LogisticsEventOut(ORMModel):
    id: str
    logistics_id: str
    time: datetime
    node: str
    description: str
    location: str | None = None


class LogisticsCreate(BaseModel):
    po_id: str = Field(min_length=1, description="采购单ID")
    carrier: str | None = Field(default=None, max_length=40)
    tracking_no: str | None = Field(default=None, max_length=64)
    expected_arrival: date | None = None
    remark: str | None = Field(default=None, max_length=300)
    status: LogisticsStatus = LogisticsStatus.PENDING


class LogisticsOut(ORMModel):
    id: str
    code: str
    po_id: str
    po_code: str | None = None
    supplier_id: str
    supplier_name: str | None = None
    carrier: str | None = None
    tracking_no: str | None = None
    expected_arrival: date | None = None
    status: str
    status_label: str = ""
    is_delayed: bool = False
    delay_days: int = 0
    remark: str | None = None
    events: list[LogisticsEventOut] = Field(default_factory=list)


class LogisticsBrief(ORMModel):
    id: str
    code: str
    po_code: str | None = None
    carrier: str | None = None
    tracking_no: str | None = None
    status: str
    status_label: str = ""
    is_delayed: bool = False
    expected_arrival: date | None = None


class DelayRefreshResult(BaseModel):
    checked: int = 0
    newly_delayed: int = 0
    cleared: int = 0
    delayed_total: int = 0
    items: list[LogisticsBrief] = Field(default_factory=list)
