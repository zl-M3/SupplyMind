"""采购服务：建单、审批、驳回、取消、收货与查询。

业务规则（规划 2.2 / schema CHECK 双重保证）：

* 创建人与审批人不能相同（``chk_po_approver``）
* 收货数量不能超过剩余未收数量（``chk_item_received``）
* 库存结存与库存流水在同一事务内写入（本模块只 ``flush``，由 API 层 ``commit``）
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, NotFoundError, PermissionDeniedError
from app.core.ids import gen_id, next_code
from app.models import (
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseReceipt,
    PurchaseReceiptItem,
    Supplier,
    User,
    Warehouse,
)
from app.models.enums import (
    LogisticsStatus,
    MasterStatus,
    PurchaseOrderStatus,
    TransactionType,
    UserRole,
)
from app.schemas.purchase import (
    PurchaseOrderCreate,
    PurchaseOrderItemOut,
    PurchaseOrderOut,
    PurchaseOrderUpdate,
    ReceiptCreate,
    ReceiptItemOut,
    ReceiptOut,
)
from app.services.inventory_service import apply_stock_change

EDITABLE_STATUSES = (PurchaseOrderStatus.DRAFT.value,)
RECEIVABLE_STATUSES = (PurchaseOrderStatus.APPROVED.value, PurchaseOrderStatus.PARTIAL.value)
CANCELLABLE_STATUSES = (
    PurchaseOrderStatus.DRAFT.value,
    PurchaseOrderStatus.PENDING.value,
    PurchaseOrderStatus.APPROVED.value,
)
OPEN_STATUSES = (
    PurchaseOrderStatus.DRAFT.value,
    PurchaseOrderStatus.PENDING.value,
    PurchaseOrderStatus.APPROVED.value,
    PurchaseOrderStatus.PARTIAL.value,
)


# --------------------------------------------------------------------------- #
# 查询
# --------------------------------------------------------------------------- #
def get_order(db: Session, order_id: str) -> PurchaseOrder:
    order = db.get(PurchaseOrder, order_id)
    if order is None:
        raise NotFoundError("采购订单不存在")
    return order


def item_to_out(item: PurchaseOrderItem) -> PurchaseOrderItemOut:
    return PurchaseOrderItemOut(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product_name,
        spec=item.spec,
        unit=item.unit,
        qty=int(item.qty or 0),
        received_qty=int(item.received_qty or 0),
        remaining_qty=item.remaining_qty,
        price=item.price,
        amount=item.amount,
    )


def order_to_out(order: PurchaseOrder, user: User | None = None) -> PurchaseOrderOut:
    is_gm = bool(user and user.role == UserRole.GM.value)
    return PurchaseOrderOut(
        id=order.id,
        code=order.code,
        supplier_id=order.supplier_id,
        supplier_name=order.supplier_name or (order.supplier.name if order.supplier else None),
        status=order.status,
        status_label=order.status_label,
        total_amount=order.total_amount,
        created_by=order.created_by,
        created_by_name=order.creator.display_name if order.creator else None,
        created_at=order.created_at,
        expected_arrival=order.expected_arrival,
        approver=order.approver,
        approver_name=order.approver_user.display_name if order.approver_user else None,
        approved_at=order.approved_at,
        reject_reason=order.reject_reason,
        remark=order.remark,
        logistics_id=order.logistics_id,
        ordered_qty=order.ordered_qty,
        received_qty=order.received_qty,
        remaining_qty=order.remaining_qty,
        can_approve=bool(
            is_gm
            and order.status == PurchaseOrderStatus.PENDING.value
            and user is not None
            and user.username != order.created_by
        ),
        can_receive=bool(
            order.status in RECEIVABLE_STATUSES
            and order.remaining_qty > 0
        ),
        items=[item_to_out(item) for item in order.items],
    )


def list_orders(
    db: Session,
    *,
    keyword: str | None = None,
    supplier_id: str | None = None,
    status: str | None = None,
    created_by: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User | None = None,
) -> tuple[list[PurchaseOrderOut], int]:
    stmt = select(PurchaseOrder)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                PurchaseOrder.code.like(like),
                PurchaseOrder.supplier_name.like(like),
                PurchaseOrder.remark.like(like),
            )
        )
    if supplier_id:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    if status:
        stmt = stmt.where(PurchaseOrder.status == status)
    if created_by:
        stmt = stmt.where(PurchaseOrder.created_by == created_by)
    if start_date:
        stmt = stmt.where(PurchaseOrder.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        stmt = stmt.where(
            PurchaseOrder.created_at
            <= datetime.combine(end_date, datetime.max.time())
        )

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.code.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [order_to_out(item, user) for item in rows], total


def list_receipts(db: Session, order_id: str) -> list[ReceiptOut]:
    order = get_order(db, order_id)
    warehouse_ids = {receipt.warehouse_id for receipt in order.receipts}
    warehouses = {
        wh.id: wh.name
        for wh in db.scalars(select(Warehouse).where(Warehouse.id.in_(warehouse_ids))).all()
    } if warehouse_ids else {}
    item_map = {item.id: item for item in order.items}

    result: list[ReceiptOut] = []
    for receipt in order.receipts:
        result.append(
            ReceiptOut(
                id=receipt.id,
                code=receipt.code,
                po_id=receipt.po_id,
                warehouse_id=receipt.warehouse_id,
                warehouse_name=warehouses.get(receipt.warehouse_id),
                received_by=receipt.received_by,
                received_at=receipt.received_at,
                remark=receipt.remark,
                items=[
                    ReceiptItemOut(
                        id=line.id,
                        po_item_id=line.po_item_id,
                        qty=int(line.qty or 0),
                        product_id=item_map[line.po_item_id].product_id
                        if line.po_item_id in item_map
                        else None,
                        product_name=item_map[line.po_item_id].product_name
                        if line.po_item_id in item_map
                        else None,
                    )
                    for line in receipt.items
                ],
            )
        )
    return result


def pending_count(db: Session) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(PurchaseOrder)
            .where(PurchaseOrder.status == PurchaseOrderStatus.PENDING.value)
        )
        or 0
    )


# --------------------------------------------------------------------------- #
# 写操作
# --------------------------------------------------------------------------- #
def _active_supplier(db: Session, supplier_id: str) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError("供应商不存在")
    if supplier.status != MasterStatus.ACTIVE.value:
        raise BusinessRuleError(
            f"供应商「{supplier.name}」已停用，不能下单", code="SUPPLIER_INACTIVE"
        )
    return supplier


def _build_items(
    db: Session, order_id: str, payloads, supplier: Supplier
) -> list[PurchaseOrderItem]:
    """构造采购明细，并校验「供应商只能采购其可供应大类的商品」。"""
    allowed = [str(item) for item in (supplier.categories or []) if item]
    items: list[PurchaseOrderItem] = []
    for payload in payloads:
        product = db.get(Product, payload.product_id)
        if product is None:
            raise NotFoundError(f"商品不存在：{payload.product_id}")
        if product.status != MasterStatus.ACTIVE.value:
            raise BusinessRuleError(
                f"商品「{product.name}」已停用，不能采购", code="PRODUCT_INACTIVE"
            )
        if allowed and product.category and product.category not in allowed:
            raise BusinessRuleError(
                f"商品「{product.name}」属于「{product.category}」，"
                f"供应商「{supplier.name}」只能供应：{'、'.join(allowed)}",
                code="SUPPLIER_CATEGORY_MISMATCH",
            )

        price = payload.price if payload.price is not None else product.purchase_price
        if price is None:
            raise BusinessRuleError(
                f"商品「{product.name}」没有参考进价，请填写单价", code="PRICE_REQUIRED"
            )
        price = Decimal(str(price)).quantize(Decimal("0.01"))
        amount = (price * int(payload.qty)).quantize(Decimal("0.01"))
        items.append(
            PurchaseOrderItem(
                id=gen_id("POI", 32),
                po_id=order_id,
                product_id=product.id,
                product_name=product.name,
                spec=product.spec,
                unit=product.unit,
                qty=int(payload.qty),
                received_qty=0,
                price=price,
                amount=amount,
            )
        )
    return items


def create_order(db: Session, payload: PurchaseOrderCreate, *, user: User) -> PurchaseOrder:
    supplier = _active_supplier(db, payload.supplier_id)
    order = PurchaseOrder(
        id=gen_id("PO", 32),
        code=next_code(db, PurchaseOrder, "code", "PO"),
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        status=PurchaseOrderStatus.DRAFT.value,
        total_amount=Decimal("0"),
        created_by=user.username,
        expected_arrival=payload.expected_arrival,
        remark=payload.remark,
    )
    db.add(order)
    db.flush()

    items = _build_items(db, order.id, payload.items, supplier)
    for item in items:
        db.add(item)
    order.total_amount = sum((item.amount for item in items), Decimal("0"))
    db.flush()
    db.refresh(order)
    return order


def update_order(
    db: Session, order_id: str, payload: PurchaseOrderUpdate, *, user: User
) -> PurchaseOrder:
    order = get_order(db, order_id)
    if order.status not in EDITABLE_STATUSES:
        raise BusinessRuleError(
            f"当前状态（{order.status_label}）不允许编辑", code="ORDER_NOT_EDITABLE"
        )
    if order.created_by != user.username and user.role != UserRole.GM.value:
        raise PermissionDeniedError("只能修改自己创建的采购订单")

    data = payload.model_dump(exclude_unset=True)
    supplier = order.supplier
    if data.get("supplier_id"):
        supplier = _active_supplier(db, data["supplier_id"])
        order.supplier_id = supplier.id
        order.supplier_name = supplier.name
    if data.get("expected_arrival"):
        order.expected_arrival = data["expected_arrival"]
    if "remark" in data:
        order.remark = data["remark"]

    if data.get("items"):
        if supplier is None:
            supplier = _active_supplier(db, order.supplier_id)
        order.items.clear()
        db.flush()
        items = _build_items(db, order.id, payload.items, supplier)
        for item in items:
            db.add(item)
            order.items.append(item)
        order.total_amount = sum((item.amount for item in items), Decimal("0"))

    db.flush()
    db.refresh(order)
    return order


def _ensure_logistics(db: Session, order: PurchaseOrder, user: User) -> None:
    """审批通过后自动生成模拟物流单（已存在则跳过）。"""
    from app.schemas.logistics import LogisticsCreate
    from app.services import logistics_service

    if logistics_service.order_logistics(db, order.id) is not None:
        return
    logistics_service.create_logistics(
        db,
        LogisticsCreate(
            po_id=order.id,
            carrier="顺丰速运",
            remark="审批通过后系统自动生成（模拟）",
        ),
        user=user,
    )


def submit_order(db: Session, order_id: str, *, user: User) -> PurchaseOrder:
    """提交采购订单。

    角色规则（规划 2.2 审批流）：

    * 采购员（SALES）提交 → 进入「待审批」，需由管理者审批；
    * 管理者（GM）提交   → 免审批，提交即「已审批」并记录审批人。
    """
    order = get_order(db, order_id)
    if order.status not in EDITABLE_STATUSES:
        raise BusinessRuleError("只有草稿状态的采购订单可以提交审批", code="ORDER_NOT_DRAFT")
    if order.created_by != user.username and user.role != UserRole.GM.value:
        raise PermissionDeniedError("只能提交自己创建的采购订单")
    if not order.items:
        raise BusinessRuleError("请先添加采购明细再提交审批", code="ORDER_EMPTY")

    if user.role == UserRole.GM.value:
        # 管理者无需审批：直接通过，避免「创建人不能审批自己」把单卡死
        order.status = PurchaseOrderStatus.APPROVED.value
        order.approver = user.username
        order.approved_at = datetime.now()
        order.remark = f"{order.remark or ''}\n管理员提交，免审批直接通过".strip()
        db.flush()
        _ensure_logistics(db, order, user)
    else:
        order.status = PurchaseOrderStatus.PENDING.value

    db.flush()
    return order


def approve_order(
    db: Session, order_id: str, *, user: User, note: str | None = None
) -> PurchaseOrder:
    order = get_order(db, order_id)
    if order.status != PurchaseOrderStatus.PENDING.value:
        raise BusinessRuleError("只有待审批的采购订单可以审批", code="ORDER_NOT_PENDING")
    if user.role != UserRole.GM.value:
        raise PermissionDeniedError("只有管理者可以审批采购订单")
    if order.created_by == user.username:
        raise BusinessRuleError(
            "创建人不能审批自己创建的采购订单，请由其他审批人处理",
            code="SELF_APPROVAL_FORBIDDEN",
        )

    order.status = PurchaseOrderStatus.APPROVED.value
    order.approver = user.username
    order.approved_at = datetime.now()
    if note:
        order.remark = f"{order.remark or ''}\n审批备注：{note}".strip()
    db.flush()
    _ensure_logistics(db, order, user)
    db.flush()
    return order


def reject_order(db: Session, order_id: str, *, user: User, reason: str) -> PurchaseOrder:
    order = get_order(db, order_id)
    if order.status != PurchaseOrderStatus.PENDING.value:
        raise BusinessRuleError("只有待审批的采购订单可以驳回", code="ORDER_NOT_PENDING")
    if user.role != UserRole.GM.value:
        raise PermissionDeniedError("只有管理者可以驳回采购订单")

    order.status = PurchaseOrderStatus.REJECTED.value
    order.approver = user.username
    order.approved_at = datetime.now()
    order.reject_reason = reason
    db.flush()
    return order


def cancel_order(
    db: Session, order_id: str, *, user: User, reason: str | None = None
) -> PurchaseOrder:
    order = get_order(db, order_id)
    if order.status not in CANCELLABLE_STATUSES:
        raise BusinessRuleError(
            f"当前状态（{order.status_label}）不允许取消", code="ORDER_NOT_CANCELLABLE"
        )
    if order.received_qty > 0:
        raise BusinessRuleError("订单已有收货记录，不能取消", code="ORDER_HAS_RECEIPTS")
    if order.created_by != user.username and user.role != UserRole.GM.value:
        raise PermissionDeniedError("只能取消自己创建的采购订单")

    order.status = PurchaseOrderStatus.CANCELLED.value
    if reason:
        order.remark = f"{order.remark or ''}\n取消原因：{reason}".strip()
    db.flush()
    return order


def receive_order(
    db: Session, order_id: str, payload: ReceiptCreate, *, user: User
) -> PurchaseReceipt:
    """收货入库：更新明细已收数量 + 增加库存 + 写库存流水，同一事务完成。"""
    order = get_order(db, order_id)
    if order.status not in RECEIVABLE_STATUSES:
        raise BusinessRuleError(
            f"当前状态（{order.status_label}）不允许收货", code="ORDER_NOT_RECEIVABLE"
        )

    warehouse = db.get(Warehouse, payload.warehouse_id)
    if warehouse is None:
        raise NotFoundError("仓库不存在")
    if warehouse.status != MasterStatus.ACTIVE.value:
        raise BusinessRuleError(f"仓库「{warehouse.name}」已停用", code="WAREHOUSE_INACTIVE")

    receipt = PurchaseReceipt(
        id=gen_id("RC", 16),
        code=next_code(db, PurchaseReceipt, "code", "RC"),
        po_id=order.id,
        warehouse_id=warehouse.id,
        received_by=user.username,
        received_at=datetime.now(),
        remark=payload.remark,
    )
    db.add(receipt)
    db.flush()

    for line in payload.items:
        # 锁住采购明细行再判断剩余量：否则并发收货都按旧的 received_qty 通过校验，会超收
        item = db.execute(
            select(PurchaseOrderItem)
            .where(PurchaseOrderItem.id == line.po_item_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if item is None:
            raise NotFoundError(f"采购明细不存在：{line.po_item_id}")
        qty = int(line.qty)
        if qty > item.remaining_qty:
            raise BusinessRuleError(
                f"「{item.product_name}」本次收货 {qty} 超过剩余未收 {item.remaining_qty}",
                code="RECEIPT_EXCEEDS_REMAINING",
                detail={
                    "po_item_id": item.id,
                    "received_qty": int(item.received_qty or 0),
                    "qty": int(item.qty or 0),
                    "remaining_qty": item.remaining_qty,
                    "requested": qty,
                },
            )

        item.received_qty = int(item.received_qty or 0) + qty
        db.add(
            PurchaseReceiptItem(
                receipt_id=receipt.id, po_item_id=item.id, qty=qty
            )
        )
        apply_stock_change(
            db,
            product_id=item.product_id,
            warehouse_id=warehouse.id,
            delta=qty,
            tx_type=TransactionType.PURCHASE_IN,
            ref_code=order.code,
            remark=f"采购收货 {receipt.code}",
            operator=user.username,
        )

    db.flush()
    db.refresh(order)
    order.status = (
        PurchaseOrderStatus.COMPLETED.value
        if order.remaining_qty == 0
        else PurchaseOrderStatus.PARTIAL.value
    )
    db.flush()

    # 全部收货后，物流单同步标记为「已签收」并补一条轨迹。
    # 否则会出现「货已入库、物流还显示待发货/在途」，准时交付率也会把它误算成未交付。
    if order.status == PurchaseOrderStatus.COMPLETED.value:
        _mark_logistics_delivered(db, order, warehouse_name=warehouse.name, user=user)

    return receipt


def _mark_logistics_delivered(
    db: Session, order: PurchaseOrder, *, warehouse_name: str, user: User
) -> None:
    """把采购单对应的物流单置为已签收（已签收则跳过）。"""
    from app.schemas.logistics import LogisticsEventCreate
    from app.services import logistics_service

    logistics = logistics_service.order_logistics(db, order.id)
    if logistics is None:
        return
    if logistics.status == LogisticsStatus.DELIVERED.value:
        return

    logistics_service.add_event(
        db,
        logistics.id,
        LogisticsEventCreate(
            node="已签收",
            description=f"采购单 {order.code} 已全部收货入库（{warehouse_name}）",
            location=warehouse_name,
            time=datetime.now(),
        ),
        user=user,
    )
