"""工作台接口。"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.dashboard import (
    AIInsightItem,
    AlertItem,
    DashboardOverview,
    KpiSummary,
    TodoItem,
    TrendSeries,
)
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["工作台"])


@router.get("/overview", response_model=DashboardOverview, summary="工作台总览")
def overview(db: DbSession, _current: CurrentUser) -> DashboardOverview:
    return dashboard_service.build_overview(db)


@router.get("/kpi", response_model=KpiSummary, summary="核心指标")
def kpi(db: DbSession, _current: CurrentUser) -> KpiSummary:
    return dashboard_service.build_kpi(db)


@router.get("/trend", response_model=TrendSeries, summary="采购趋势")
def trend(
    db: DbSession,
    _current: CurrentUser,
    days: Annotated[int, Query(ge=1, le=180, description="统计天数")] = 7,
    start_date: Annotated[date | None, Query(description="开始日期")] = None,
    end_date: Annotated[date | None, Query(description="结束日期")] = None,
) -> TrendSeries:
    return dashboard_service.build_trend(
        db, days=days, start_date=start_date, end_date=end_date
    )


@router.get("/charts", summary="工作台图表数据（库存结构/供应商评分/物流分布）")
def charts(db: DbSession, _current: CurrentUser) -> dict:
    return dashboard_service.build_charts(db)


@router.get("/todos", response_model=list[TodoItem], summary="待办事项")
def todos(db: DbSession, _current: CurrentUser) -> list[TodoItem]:
    return dashboard_service.build_todos(db)


@router.get("/alerts", response_model=list[AlertItem], summary="风险提醒")
def alerts(db: DbSession, _current: CurrentUser) -> list[AlertItem]:
    return dashboard_service.build_alerts(db)


@router.get("/ai-insights", response_model=list[AIInsightItem], summary="AI 洞察")
def ai_insights(db: DbSession, _current: CurrentUser) -> list[AIInsightItem]:
    return dashboard_service.build_ai_insights(db)
