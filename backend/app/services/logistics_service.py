"""物流服务：物流单创建、轨迹节点、延迟刷新与查询。

延迟口径（规划 2.4 / 视图 ``v_logistics_delayed``）：
``status <> 'delivered' AND expected_arrival < CURDATE()``
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.core.ids import gen_id, next_code
from app.models import LogisticsEvent, LogisticsOrder, PurchaseOrder, User
from app.models.enums import LogisticsStatus, PurchaseOrderStatus
from app.schemas.logistics import (
    DelayRefreshResult,
    LogisticsBrief,
    LogisticsCreate,
    LogisticsEventCreate,
    LogisticsEventOut,
    LogisticsOut,
)
from app.services.rules import delay_days_of

FINAL_STATUSES = (LogisticsStatus.DELIVERED.value,)
CREATABLE_PO_STATUSES = (
    PurchaseOrderStatus.APPROVED.value,
    PurchaseOrderStatus.PARTIAL.value,
    PurchaseOrderStatus.COMPLETED.value,
)

# 节点名称 → 物流状态（手动模拟节点时按关键词推进状态）
_NODE_STATUS_HINTS: tuple[tuple[tuple[str, ...], LogisticsStatus], ...] = (
    (("签收", "已送达", "delivered"), LogisticsStatus.DELIVERED),
    (("异常", "滞留", "破损", "取消", "exception"), LogisticsStatus.EXCEPTION),
    (("到达", "到港", "抵达", "arrived"), LogisticsStatus.ARRIVED),
    (("运输", "中转", "发出", "在途", "in_transit"), LogisticsStatus.IN_TRANSIT),
    (("待发", "已下单", "pending"), LogisticsStatus.PENDING),
)


def status_from_node(node: str) -> LogisticsStatus | None:
    """根据节点名称推断物流状态，未命中则返回 None。"""
    text = (node or "").lower()
    for keywords, status in _NODE_STATUS_HINTS:
        if any(keyword.lower() in text for keyword in keywords):
            return status
    return None


def get_logistics(db: Session, logistics_id: str) -> LogisticsOrder:
    order = db.get(LogisticsOrder, logistics_id)
    if order is None:
        raise NotFoundError("物流单不存在")
    return order


def is_delayed_now(order: LogisticsOrder, today: date | None = None) -> bool:
    today = today or date.today()
    if order.status in FINAL_STATUSES:
        return False
    if order.expected_arrival is None:
        return False
    return today > order.expected_arrival


def delay_days(order: LogisticsOrder, today: date | None = None) -> int:
    today = today or date.today()
    if order.status in FINAL_STATUSES:
        return 0
    return delay_days_of(today, order.expected_arrival)


def event_to_out(event: LogisticsEvent) -> LogisticsEventOut:
    return LogisticsEventOut.model_validate(event)


def logistics_to_out(order: LogisticsOrder, today: date | None = None) -> LogisticsOut:
    today = today or date.today()
    return LogisticsOut(
        id=order.id,
        code=order.code,
        po_id=order.po_id,
        po_code=order.po_code,
        supplier_id=order.supplier_id,
        supplier_name=order.supplier_name,
        carrier=order.carrier,
        tracking_no=order.tracking_no,
        expected_arrival=order.expected_arrival,
        status=order.status,
        status_label=_status_label(order.status),
        is_delayed=is_delayed_now(order, today),
        delay_days=delay_days(order, today),
        remark=order.remark,
        events=[event_to_out(event) for event in order.events],
    )


def to_brief(order: LogisticsOrder, today: date | None = None) -> LogisticsBrief:
    today = today or date.today()
    return LogisticsBrief(
        id=order.id,
        code=order.code,
        po_code=order.po_code,
        carrier=order.carrier,
        tracking_no=order.tracking_no,
        status=order.status,
        status_label=_status_label(order.status),
        is_delayed=is_delayed_now(order, today),
        expected_arrival=order.expected_arrival,
    )


def list_logistics(
    db: Session,
    *,
    keyword: str | None = None,
    status: str | None = None,
    only_delayed: bool = False,
    po_id: str | None = None,
    supplier_id: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[LogisticsOut], int]:
    stmt = select(LogisticsOrder)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                LogisticsOrder.code.like(like),
                LogisticsOrder.tracking_no.like(like),
                LogisticsOrder.supplier_name.like(like),
                LogisticsOrder.po_code.like(like),
            )
        )
    if status:
        stmt = stmt.where(LogisticsOrder.status == status)
    if po_id:
        stmt = stmt.where(LogisticsOrder.po_id == po_id)
    if supplier_id:
        stmt = stmt.where(LogisticsOrder.supplier_id == supplier_id)
    if only_delayed:
        stmt = stmt.where(
            LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
            LogisticsOrder.expected_arrival.is_not(None),
            LogisticsOrder.expected_arrival < date.today(),
        )

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(LogisticsOrder.expected_arrival.desc(), LogisticsOrder.code.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    today = date.today()
    return [logistics_to_out(item, today) for item in rows], total


def order_logistics(db: Session, po_id: str) -> LogisticsOrder | None:
    return db.execute(
        select(LogisticsOrder).where(LogisticsOrder.po_id == po_id)
    ).scalar_one_or_none()


def create_logistics(db: Session, payload: LogisticsCreate, *, user: User) -> LogisticsOrder:
    purchase = db.get(PurchaseOrder, payload.po_id)
    if purchase is None:
        raise NotFoundError("采购订单不存在")
    if purchase.status not in CREATABLE_PO_STATUSES:
        raise BusinessRuleError(
            f"采购订单当前状态（{purchase.status_label}）还不能创建物流单",
            code="ORDER_NOT_APPROVED",
        )
    if order_logistics(db, purchase.id) is not None:
        raise ConflictError("该采购订单已存在物流单", code="LOGISTICS_EXISTS")

    code = next_code(db, LogisticsOrder, "code", "LG")
    tracking_no = (payload.tracking_no or "").strip() or code
    if db.scalar(
        select(func.count())
        .select_from(LogisticsOrder)
        .where(LogisticsOrder.tracking_no == tracking_no)
    ):
        raise ConflictError(f"运单号已存在：{tracking_no}", code="TRACKING_NO_EXISTS")

    order = LogisticsOrder(
        id=gen_id("LG", 16),
        code=code,
        po_id=purchase.id,
        po_code=purchase.code,
        supplier_id=purchase.supplier_id,
        supplier_name=purchase.supplier_name,
        carrier=payload.carrier,
        tracking_no=tracking_no,
        expected_arrival=payload.expected_arrival or purchase.expected_arrival,
        status=_as_value(payload.status) or LogisticsStatus.PENDING.value,
        is_delayed=False,
        remark=payload.remark,
    )
    db.add(order)
    db.flush()

    db.add(
        LogisticsEvent(
            id=gen_id("LGE", 24),
            logistics_id=order.id,
            time=datetime.now(),
            node="已创建物流单",
            description=f"承运商 {payload.carrier or '待定'}，运单号 {tracking_no}",
            location=None,
        )
    )
    purchase.logistics_id = order.id
    db.flush()
    return order


def add_event(
    db: Session, logistics_id: str, payload: LogisticsEventCreate, *, user: User
) -> LogisticsOrder:
    order = get_logistics(db, logistics_id)
    if order.status in FINAL_STATUSES:
        raise BusinessRuleError("物流单已签收，不能再追加节点", code="LOGISTICS_FINALIZED")

    occurred = payload.time or datetime.now()
    db.add(
        LogisticsEvent(
            id=gen_id("LGE", 24),
            logistics_id=order.id,
            time=occurred,
            node=payload.node,
            description=payload.description,
            location=payload.location,
        )
    )

    inferred = status_from_node(payload.node)
    if inferred is not None:
        order.status = inferred.value
    order.is_delayed = is_delayed_now(order)
    db.flush()
    return order


def update_status(
    db: Session, logistics_id: str, status: str, *, user: User
) -> LogisticsOrder:
    order = get_logistics(db, logistics_id)
    if order.status in FINAL_STATUSES:
        raise BusinessRuleError("物流单已签收，不能再修改状态", code="LOGISTICS_FINALIZED")
    order.status = _as_value(status)
    order.is_delayed = is_delayed_now(order)
    db.flush()
    return order


def refresh_delays(db: Session) -> DelayRefreshResult:
    """按当前日期刷新延迟标记（对应视图 v_logistics_delayed 的口径）。"""
    today = date.today()
    orders = db.scalars(
        select(LogisticsOrder).where(
            LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
            LogisticsOrder.expected_arrival.is_not(None),
        )
    ).all()

    result = DelayRefreshResult(checked=len(orders))
    for order in orders:
        should_delay = today > order.expected_arrival
        before = bool(order.is_delayed)
        if should_delay and not before:
            result.newly_delayed += 1
        elif before and not should_delay:
            result.cleared += 1
        order.is_delayed = should_delay
        if should_delay:
            result.items.append(to_brief(order, today))

    db.flush()
    result.delayed_total = int(
        db.scalar(
            select(func.count())
            .select_from(LogisticsOrder)
            .where(
                LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
                LogisticsOrder.expected_arrival.is_not(None),
                LogisticsOrder.expected_arrival < today,
            )
        )
        or 0
    )
    return result


def delayed_count(db: Session) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(LogisticsOrder)
            .where(
                LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
                LogisticsOrder.expected_arrival.is_not(None),
                LogisticsOrder.expected_arrival < date.today(),
            )
        )
        or 0
    )


def _status_label(status: str) -> str:
    try:
        return LogisticsStatus(status).label
    except ValueError:  # pragma: no cover
        return status


def _as_value(value) -> str | None:
    if value is None:
        return None
    return getattr(value, "value", value)
