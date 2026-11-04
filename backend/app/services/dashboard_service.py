"""工作台总览：KPI、近七日采购趋势、待办、预警与 AI 洞察。

所有数字都直接来自数据库聚合，AI 洞察只是对同一批事实的解释，不引入新口径。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import LogisticsOrder, Product, PurchaseOrder, Supplier
from app.models.enums import LogisticsStatus, PurchaseOrderStatus
from app.schemas.dashboard import (
    AIInsightItem,
    AlertItem,
    DashboardOverview,
    KpiSummary,
    TodoItem,
    TrendPoint,
    TrendSeries,
)
from app.services.inventory_service import inventory_alerts, inventory_summary


def period_label(now: datetime) -> str:
    return f"{now.year}年{now.month}月"


def _delayed_stmt():
    return select(func.count()).select_from(LogisticsOrder).where(
        LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
        LogisticsOrder.expected_arrival.is_not(None),
        LogisticsOrder.expected_arrival < date.today(),
    )


def build_kpi(db: Session, now: datetime | None = None) -> KpiSummary:
    now = now or datetime.now()
    month_start = datetime(now.year, now.month, 1)

    po_count, po_amount = db.execute(
        select(
            func.count(PurchaseOrder.id),
            func.coalesce(func.sum(PurchaseOrder.total_amount), 0),
        ).where(PurchaseOrder.created_at >= month_start)
    ).one()

    summary = inventory_summary(db)

    return KpiSummary(
        period_label=period_label(now),
        po_count=int(po_count or 0),
        po_amount=Decimal(str(po_amount or 0)).quantize(Decimal("0.01")),
        total_qty=summary.total_qty,
        low_stock_count=summary.low_count + summary.out_of_stock_count,
        pending_count=int(
            db.scalar(
                select(func.count())
                .select_from(PurchaseOrder)
                .where(PurchaseOrder.status == PurchaseOrderStatus.PENDING.value)
            )
            or 0
        ),
        delayed_count=int(db.scalar(_delayed_stmt()) or 0),
        supplier_count=int(db.scalar(select(func.count()).select_from(Supplier)) or 0),
        product_count=int(db.scalar(select(func.count()).select_from(Product)) or 0),
    )


def build_trend(
    db: Session,
    now: datetime | None = None,
    days: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> TrendSeries:
    now = now or datetime.now()
    if start_date and end_date and end_date >= start_date:
        start = datetime.combine(start_date, datetime.min.time())
        end = datetime.combine(end_date, datetime.min.time()) + timedelta(days=1)
        days = (end_date - start_date).days + 1
    else:
        days = days or settings.DASHBOARD_TREND_DAYS
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=days)

    rows = db.execute(
        select(
            func.date(PurchaseOrder.created_at),
            func.count(PurchaseOrder.id),
            func.coalesce(func.sum(PurchaseOrder.total_amount), 0),
        )
        .where(PurchaseOrder.created_at >= start, PurchaseOrder.created_at < end)
        .group_by(func.date(PurchaseOrder.created_at))
    ).all()

    bucket = {str(row[0]): (int(row[1] or 0), Decimal(str(row[2] or 0))) for row in rows}
    points: list[TrendPoint] = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).date()
        count, amount = bucket.get(str(day), (0, Decimal("0")))
        points.append(
            TrendPoint(date=day, amount=Decimal(amount).quantize(Decimal("0.01")), count=count)
        )
    return TrendSeries(days=days, points=points)


def build_todos(db: Session, limit: int = 5) -> list[TodoItem]:
    todos: list[TodoItem] = []

    pending = db.scalars(
        select(PurchaseOrder)
        .where(PurchaseOrder.status == PurchaseOrderStatus.PENDING.value)
        .order_by(PurchaseOrder.created_at)
        .limit(limit)
    ).all()
    for order in pending:
        todos.append(
            TodoItem(
                id=f"approval-{order.id}",
                type="purchase_approval",
                title=f"采购单 {order.code} 待审批",
                description=f"供应商：{order.supplier_name or '-'}，金额 ￥{order.total_amount}",
                level="warning",
                target_id=order.id,
            )
        )

    receivable = db.scalars(
        select(PurchaseOrder)
        .where(
            PurchaseOrder.status.in_(
                (PurchaseOrderStatus.APPROVED.value, PurchaseOrderStatus.PARTIAL.value)
            )
        )
        .order_by(PurchaseOrder.expected_arrival)
        .limit(limit)
    ).all()
    for order in receivable:
        remaining = order.remaining_qty
        if remaining <= 0:
            continue
        todos.append(
            TodoItem(
                id=f"receipt-{order.id}",
                type="purchase_receipt",
                title=f"采购单 {order.code} 待收货",
                description=f"剩余未收 {remaining}，预计到货 {order.expected_arrival}",
                level="info",
                target_id=order.id,
            )
        )

    delayed = db.scalars(
        select(LogisticsOrder)
        .where(
            LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
            LogisticsOrder.expected_arrival.is_not(None),
            LogisticsOrder.expected_arrival < date.today(),
        )
        .order_by(LogisticsOrder.expected_arrival)
        .limit(limit)
    ).all()
    for order in delayed:
        overdue = (date.today() - order.expected_arrival).days
        todos.append(
            TodoItem(
                id=f"logistics-{order.id}",
                type="logistics_exception",
                title=f"物流单 {order.code} 已延迟 {overdue} 天",
                description=f"承运商：{order.carrier or '-'}，预计到达 {order.expected_arrival}",
                level="critical",
                target_id=order.id,
            )
        )
    return todos[: limit * 2]


def build_alerts(db: Session, limit: int = 6) -> list[AlertItem]:
    alerts: list[AlertItem] = []
    items, _ = inventory_alerts(db, page=1, page_size=limit)
    for item in items:
        alerts.append(
            AlertItem(
                id=f"stock-{item.product_id}",
                level="critical" if item.status == "out_of_stock" else "warning",
                title=f"{item.product_name}（{item.status_label}）",
                description=(
                    f"现存 {item.current_qty}，安全库存 {item.safety_stock}，"
                    f"缺口 {item.shortage}；{item.suggested_action}"
                ),
                target_id=item.product_id,
            )
        )

    delayed = db.scalars(
        select(LogisticsOrder)
        .where(
            LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
            LogisticsOrder.expected_arrival.is_not(None),
            LogisticsOrder.expected_arrival < date.today(),
        )
        .order_by(LogisticsOrder.expected_arrival)
        .limit(limit)
    ).all()
    for order in delayed:
        overdue = (date.today() - order.expected_arrival).days
        alerts.append(
            AlertItem(
                id=f"logistics-{order.id}",
                level="warning",
                title=f"物流单 {order.code} 延迟 {overdue} 天",
                description=f"采购单 {order.po_code or '-'}，承运商 {order.carrier or '-'}",
                target_id=order.id,
            )
        )
    return alerts


def build_ai_insights(db: Session) -> list[AIInsightItem]:
    insights: list[AIInsightItem] = []
    items, _total = inventory_alerts(db, page=1, page_size=5)
    shortage = [item for item in items if item.status == "out_of_stock"]
    if shortage:
        names = "、".join(item.product_name for item in shortage[:3])
        insights.append(
            AIInsightItem(
                level="critical",
                title=f"{len(shortage)} 个商品已缺货",
                description=f"{names} 等商品库存为 0，建议用 AI 补货测算生成采购草稿。",
            )
        )

    low = [item for item in items if item.status == "low"]
    if low:
        insights.append(
            AIInsightItem(
                level="warning",
                title=f"{len(low)} 个商品低于安全库存",
                description="建议按「安全库存 - 当前库存 - 在途未收货」计算补货量后集中下单。",
            )
        )

    delayed = int(db.scalar(_delayed_stmt()) or 0)
    if delayed:
        insights.append(
            AIInsightItem(
                level="warning",
                title=f"{delayed} 张物流单已超预计到达时间",
                description="可在物流详情页发起「物流异常分析」，AI 会给出影响范围与处理动作。",
            )
        )

    pending = int(
        db.scalar(
            select(func.count())
            .select_from(PurchaseOrder)
            .where(PurchaseOrder.status == PurchaseOrderStatus.PENDING.value)
        )
        or 0
    )
    if pending:
        insights.append(
            AIInsightItem(
                level="info",
                title=f"{pending} 张采购单待审批",
                description="审批人不能是创建人，请转发给其他管理者处理。",
            )
        )

    if not insights:
        insights.append(
            AIInsightItem(
                level="info",
                title="暂无风险项",
                description="库存、物流与审批均在正常范围内。",
            )
        )
    return insights


def build_overview(db: Session, now: datetime | None = None) -> DashboardOverview:
    now = now or datetime.now()
    return DashboardOverview(
        kpi=build_kpi(db, now),
        trend=build_trend(db, now),
        todos=build_todos(db),
        alerts=build_alerts(db),
        ai_insights=build_ai_insights(db),
        ai_enabled=settings.llm_ready,
        ai_mode="llm" if settings.llm_ready else "rule",
    )


def build_charts(db: Session) -> dict:
    """工作台图表：库存结构、供应商准时率、物流状态分布。"""
    from app.models import WarehouseStock
    from app.services.master_data_service import list_suppliers, supplier_statistics

    stock_rows = db.execute(
        select(
            Product.category,
            func.coalesce(func.sum(WarehouseStock.qty), 0).label("qty"),
            func.coalesce(
                func.sum(WarehouseStock.qty * func.coalesce(Product.purchase_price, 0)), 0
            ).label("amount"),
        )
        .select_from(Product)
        .outerjoin(WarehouseStock, WarehouseStock.product_id == Product.id)
        .group_by(Product.category)
        .order_by(func.coalesce(func.sum(WarehouseStock.qty), 0).desc())
    ).all()
    inventory_by_category = [
        {
            "category": str(row[0] or "未分类"),
            "qty": int(row[1] or 0),
            "amount": float(row[2] or 0),
        }
        for row in stock_rows
        if int(row[1] or 0) > 0
    ]

    status_rows = db.execute(
        select(LogisticsOrder.status, func.count()).group_by(LogisticsOrder.status)
    ).all()
    status_labels = {item.value: item.label for item in LogisticsStatus}
    logistics_status = [
        {"status": str(status), "label": status_labels.get(status, str(status)), "count": int(count)}
        for status, count in status_rows
    ]

    suppliers, _total = list_suppliers(db, page=1, page_size=50)
    supplier_scores: list[dict] = []
    for supplier in suppliers:
        stats = supplier_statistics(db, supplier.id)
        supplier_scores.append(
            {
                "supplier_id": supplier.id,
                "name": supplier.name,
                "on_time_rate": stats.on_time_rate,
                "completed_orders": stats.completed_orders,
                "delayed_orders": stats.delayed_orders,
                "total_purchase_amount": float(stats.total_purchase_amount or 0),
            }
        )
    supplier_scores.sort(
        key=lambda item: (item["on_time_rate"] is not None, item["on_time_rate"] or 0),
        reverse=True,
    )

    return {
        "inventory_by_category": inventory_by_category,
        "logistics_status": logistics_status,
        "supplier_scores": supplier_scores,
    }
