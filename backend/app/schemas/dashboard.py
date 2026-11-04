"""工作台总览的出入参。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class KpiSummary(BaseModel):
    period_label: str = ""
    po_count: int = 0
    po_amount: Decimal = Decimal("0")
    total_qty: int = 0
    low_stock_count: int = 0
    pending_count: int = 0
    delayed_count: int = 0
    supplier_count: int = 0
    product_count: int = 0


class TrendPoint(BaseModel):
    date: date
    amount: Decimal = Decimal("0")
    count: int = 0


class TrendSeries(BaseModel):
    days: int = 0
    points: list[TrendPoint] = Field(default_factory=list)


class TodoItem(BaseModel):
    id: str
    type: str
    title: str
    description: str = ""
    level: str = "info"
    target_id: str | None = None


class AlertItem(BaseModel):
    id: str
    level: str
    title: str
    description: str = ""
    target_id: str | None = None


class AIInsightItem(BaseModel):
    level: str = "info"
    title: str
    description: str = ""


class DashboardOverview(BaseModel):
    kpi: KpiSummary
    trend: TrendSeries
    todos: list[TodoItem] = Field(default_factory=list)
    alerts: list[AlertItem] = Field(default_factory=list)
    ai_insights: list[AIInsightItem] = Field(default_factory=list)
    ai_enabled: bool = False
    ai_mode: str = "rule"
