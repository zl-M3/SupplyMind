"""库存服务：结存、流水、总览、预警与补货测算。

核心约束（规划 2.2.B）：**库存更新与流水写入必须同一事务完成**，
因此本模块所有写操作只做 ``flush``，由调用方统一 ``commit``。
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Iterable

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, NotFoundError
from app.core.ids import gen_id
from app.models import (
    InventoryTransaction,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    TransactionType,
    Warehouse,
    WarehouseStock,
)
from app.models.enums import PurchaseOrderStatus
from app.schemas.inventory import (
    InventoryAlertItem,
    InventoryItem,
    InventorySummary,
    ReplenishmentResult,
    TransactionOut,
    WarehouseStockItem,
    WarehouseStockRow,
)
from app.services.rules import (
    compute_replenishment,
    replenishment_formula_text,
    stock_status_of,
    suggested_action_of,
)

ACTIVE_PO_STATUSES = (
    PurchaseOrderStatus.APPROVED.value,
    PurchaseOrderStatus.PARTIAL.value,
)


# --------------------------------------------------------------------------- #
# 结存读写
# --------------------------------------------------------------------------- #
def get_stock_row(db: Session, warehouse_id: str, product_id: str) -> WarehouseStock | None:
    stmt = select(WarehouseStock).where(
        WarehouseStock.warehouse_id == warehouse_id,
        WarehouseStock.product_id == product_id,
    )
    return db.execute(stmt).scalar_one_or_none()


def product_total_qty(db: Session, product_id: str) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(WarehouseStock.qty), 0)).where(
            WarehouseStock.product_id == product_id
        )
    )
    return int(total or 0)


def product_qty_map(db: Session, product_ids: Iterable[str]) -> dict[str, int]:
    ids = [pid for pid in product_ids]
    if not ids:
        return {}
    rows = db.execute(
        select(WarehouseStock.product_id, func.coalesce(func.sum(WarehouseStock.qty), 0))
        .where(WarehouseStock.product_id.in_(ids))
        .group_by(WarehouseStock.product_id)
    ).all()
    return {row[0]: int(row[1] or 0) for row in rows}


def incoming_qty(db: Session, product_id: str) -> int:
    """已审批/部分收货订单里尚未收货的数量。"""
    total = db.scalar(
        select(func.coalesce(func.sum(PurchaseOrderItem.qty - PurchaseOrderItem.received_qty), 0))
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.po_id)
        .where(
            PurchaseOrderItem.product_id == product_id,
            PurchaseOrder.status.in_(ACTIVE_PO_STATUSES),
        )
    )
    return int(total or 0)


def lock_stock_writes(db: Session) -> None:
    """把库存写操作串行化。

    并发收货/调拨同时「先读后写」warehouse_stock 会互相踩：轻则唯一键冲突
    （两个请求都 INSERT 同一行），重则 InnoDB 死锁（1213 → HTTP 500）。
    MySQL 上没有便宜的方式做乐观并发，这里直接锁一行系统参数当互斥量：
    行锁随事务提交/回滚自动释放，比 GET_LOCK 安全（不会漏在连接池里）。
    """
    bind = db.get_bind()
    if bind is None or bind.dialect.name == "sqlite":
        return
    try:
        db.execute(text("SELECT id FROM system_configs ORDER BY id LIMIT 1 FOR UPDATE"))
    except Exception:  # noqa: BLE001 - 初始化阶段（表还没建）跳过
        pass


def apply_stock_change(
    db: Session,
    *,
    product_id: str,
    warehouse_id: str,
    delta: int,
    tx_type: TransactionType,
    ref_code: str | None = None,
    remark: str | None = None,
    operator: str | None = None,
) -> InventoryTransaction:
    """调整库存并写一条流水（只 flush，不 commit）。

    :raises BusinessRuleError: 出库数量超过结存
    """
    delta = int(delta)
    if delta == 0:
        raise BusinessRuleError("库存变动数量不能为 0", code="INVALID_STOCK_DELTA")

    # 先拿写锁再读结存，避免并发下读到同一个旧值
    lock_stock_writes(db)

    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"商品不存在：{product_id}")
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError(f"仓库不存在：{warehouse_id}")

    now = datetime.now()
    bind = db.get_bind()
    is_mysql = bind is not None and bind.dialect.name == "mysql"

    if is_mysql:
        # 原子增减：并发下不会出现「两个请求都读到同一旧值」或重复 INSERT
        if delta > 0:
            db.execute(
                text(
                    "INSERT INTO warehouse_stock (product_id, warehouse_id, qty, updated_at) "
                    "VALUES (:pid, :wid, :delta, :now) "
                    "ON DUPLICATE KEY UPDATE qty = qty + :delta, updated_at = :now"
                ),
                {"pid": product_id, "wid": warehouse_id, "delta": delta, "now": now},
            )
        else:
            result = db.execute(
                text(
                    "UPDATE warehouse_stock SET qty = qty + :delta, updated_at = :now "
                    "WHERE product_id = :pid AND warehouse_id = :wid AND qty + :delta >= 0"
                ),
                {"pid": product_id, "wid": warehouse_id, "delta": delta, "now": now},
            )
            if result.rowcount == 0:
                current = db.execute(
                    text(
                        "SELECT qty FROM warehouse_stock "
                        "WHERE product_id = :pid AND warehouse_id = :wid"
                    ),
                    {"pid": product_id, "wid": warehouse_id},
                ).scalar()
                available = int(current or 0)
                raise BusinessRuleError(
                    f"仓库「{warehouse.name}」中「{product.name}」库存不足：现有 {available}，需要 {-delta}",
                    code="INSUFFICIENT_STOCK",
                    detail={
                        "product_id": product_id,
                        "warehouse_id": warehouse_id,
                        "available": available,
                        "required": -delta,
                    },
                )
        after = int(
            db.execute(
                text(
                    "SELECT qty FROM warehouse_stock "
                    "WHERE product_id = :pid AND warehouse_id = :wid"
                ),
                {"pid": product_id, "wid": warehouse_id},
            ).scalar()
            or 0
        )
        before = after - delta
        row = get_stock_row(db, warehouse_id, product_id)
        if row is not None:
            # 让 ORM 里的旧结存失效，避免同一次请求里读到脏值
            db.expire(row)
    else:
        row = get_stock_row(db, warehouse_id, product_id)
        before = int(row.qty) if row else 0
        after = before + delta
        if after < 0:
            raise BusinessRuleError(
                f"仓库「{warehouse.name}」中「{product.name}」库存不足：现有 {before}，需要 {-delta}",
                code="INSUFFICIENT_STOCK",
                detail={
                    "product_id": product_id,
                    "warehouse_id": warehouse_id,
                    "available": before,
                    "required": -delta,
                },
            )
        if row is None:
            row = WarehouseStock(
                product_id=product_id, warehouse_id=warehouse_id, qty=after, updated_at=now
            )
            db.add(row)
        else:
            row.qty = after
            row.updated_at = now

    tx = InventoryTransaction(
        id=gen_id("TX", 24),
        type=tx_type.value,
        product_id=product_id,
        product_name=product.name,
        warehouse_id=warehouse_id,
        warehouse_name=warehouse.name,
        qty=delta,
        before_qty=before,
        after_qty=after,
        ref_code=ref_code,
        operator=operator,
        remark=remark,
        created_at=now,
    )
    db.add(tx)
    db.flush()
    return tx


# --------------------------------------------------------------------------- #
# 总览 / 预警 / 汇总
# --------------------------------------------------------------------------- #
def _qty_subquery():
    return (
        select(
            WarehouseStock.product_id.label("product_id"),
            func.coalesce(func.sum(WarehouseStock.qty), 0).label("total_qty"),
        )
        .group_by(WarehouseStock.product_id)
        .subquery()
    )


def _status_expr(total_col):
    from sqlalchemy import case

    return case(
        (total_col <= 0, "out_of_stock"),
        (total_col < Product.safety_stock, "low"),
        else_="normal",
    )


def inventory_overview(
    db: Session,
    *,
    keyword: str | None = None,
    category: str | None = None,
    status: str | None = None,
    warehouse_id: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[InventoryItem], int]:
    """库存总览：按商品汇总所有仓库的现存数量。"""
    qty_sub = _qty_subquery()
    total_col = func.coalesce(qty_sub.c.total_qty, 0)
    stmt = select(Product, total_col.label("total_qty")).outerjoin(
        qty_sub, qty_sub.c.product_id == Product.id
    )

    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Product.name.like(like), Product.code.like(like)))
    if category:
        stmt = stmt.where(Product.category == category)
    if warehouse_id:
        stmt = stmt.where(
            Product.id.in_(select(WarehouseStock.product_id).where(
                WarehouseStock.warehouse_id == warehouse_id
            ))
        )
    if status:
        stmt = stmt.where(_status_expr(total_col) == status)

    stmt = stmt.order_by(total_col.asc(), Product.code.asc())

    count_stmt = select(func.count()).select_from(Product).outerjoin(
        qty_sub, qty_sub.c.product_id == Product.id
    )
    if keyword:
        like = f"%{keyword.strip()}%"
        count_stmt = count_stmt.where(or_(Product.name.like(like), Product.code.like(like)))
    if category:
        count_stmt = count_stmt.where(Product.category == category)
    if warehouse_id:
        count_stmt = count_stmt.where(
            Product.id.in_(select(WarehouseStock.product_id).where(
                WarehouseStock.warehouse_id == warehouse_id
            ))
        )
    if status:
        count_stmt = count_stmt.where(_status_expr(total_col) == status)
    total = int(db.scalar(count_stmt) or 0)

    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    items = [_to_inventory_item(db, product, int(qty or 0), warehouse_id) for product, qty in rows]
    return items, total


def _to_inventory_item(
    db: Session, product: Product, total_qty: int, warehouse_id: str | None = None
) -> InventoryItem:
    status = stock_status_of(total_qty, product.safety_stock)
    return InventoryItem(
        product_id=product.id,
        product_code=product.code,
        product_name=product.name,
        category=product.category,
        spec=product.spec,
        unit=product.unit,
        safety_stock=int(product.safety_stock or 0),
        purchase_price=product.purchase_price,
        total_qty=total_qty,
        status=status.value,
        status_label=status.label,
        gap=max(int(product.safety_stock or 0) - total_qty, 0),
        warehouses=product_warehouse_breakdown(db, product.id)
        if warehouse_id is None
        else _warehouse_only(db, product.id, warehouse_id),
    )


def _warehouse_only(db: Session, product_id: str, warehouse_id: str) -> list[WarehouseStockItem]:
    rows = db.execute(
        select(WarehouseStock, Warehouse)
        .join(Warehouse, Warehouse.id == WarehouseStock.warehouse_id)
        .where(WarehouseStock.product_id == product_id, WarehouseStock.warehouse_id == warehouse_id)
    ).all()
    return [
        WarehouseStockItem(
            warehouse_id=wh.id, warehouse_code=wh.code, warehouse_name=wh.name, qty=int(stock.qty)
        )
        for stock, wh in rows
    ]


def product_warehouse_breakdown(db: Session, product_id: str) -> list[WarehouseStockItem]:
    rows = db.execute(
        select(WarehouseStock, Warehouse)
        .join(Warehouse, Warehouse.id == WarehouseStock.warehouse_id)
        .where(WarehouseStock.product_id == product_id)
        .order_by(Warehouse.code)
    ).all()
    return [
        WarehouseStockItem(
            warehouse_id=wh.id, warehouse_code=wh.code, warehouse_name=wh.name, qty=int(stock.qty)
        )
        for stock, wh in rows
    ]


def inventory_summary(db: Session) -> InventorySummary:
    qty_sub = _qty_subquery()
    total_col = func.coalesce(qty_sub.c.total_qty, 0)
    rows = db.execute(
        select(Product.id, Product.safety_stock, Product.purchase_price, total_col).outerjoin(
            qty_sub, qty_sub.c.product_id == Product.id
        )
    ).all()

    summary = InventorySummary(total_sku=len(rows))
    for _pid, safety, price, qty in rows:
        qty = int(qty or 0)
        summary.total_qty += qty
        status = stock_status_of(qty, int(safety or 0))
        if status.value == "normal":
            summary.normal_count += 1
        elif status.value == "low":
            summary.low_count += 1
        else:
            summary.out_of_stock_count += 1
        if price is not None:
            summary.total_value += Decimal(str(price)) * qty
    summary.total_value = summary.total_value.quantize(Decimal("0.01"))
    return summary


def inventory_alerts(
    db: Session,
    *,
    keyword: str | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[InventoryAlertItem], int]:
    """库存预警：只返回缺货与低库存，缺货优先，缺口大的在前。"""
    qty_sub = _qty_subquery()
    total_col = func.coalesce(qty_sub.c.total_qty, 0)
    shortage = Product.safety_stock - total_col
    stmt = (
        select(Product, total_col.label("total_qty"))
        .outerjoin(qty_sub, qty_sub.c.product_id == Product.id)
        .where(_status_expr(total_col) != "normal")
    )
    count_stmt = select(func.count()).select_from(Product).outerjoin(
        qty_sub, qty_sub.c.product_id == Product.id
    ).where(_status_expr(total_col) != "normal")

    if keyword:
        like = f"%{keyword.strip()}%"
        cond = or_(Product.name.like(like), Product.code.like(like))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if category:
        stmt = stmt.where(Product.category == category)
        count_stmt = count_stmt.where(Product.category == category)

    stmt = stmt.order_by(shortage.desc(), Product.code.asc())
    total = int(db.scalar(count_stmt) or 0)
    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()

    items = []
    for product, qty in rows:
        qty = int(qty or 0)
        status = stock_status_of(qty, int(product.safety_stock or 0))
        items.append(
            InventoryAlertItem(
                product_id=product.id,
                product_code=product.code,
                product_name=product.name,
                category=product.category,
                unit=product.unit,
                current_qty=qty,
                safety_stock=int(product.safety_stock or 0),
                shortage=max(int(product.safety_stock or 0) - qty, 0),
                status=status.value,
                status_label=status.label,
                suggested_action=suggested_action_of(status),
            )
        )
    return items, total


def list_transactions(
    db: Session,
    *,
    product_id: str | None = None,
    warehouse_id: str | None = None,
    tx_type: str | None = None,
    ref_code: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[TransactionOut], int]:
    stmt = select(InventoryTransaction)
    if product_id:
        stmt = stmt.where(InventoryTransaction.product_id == product_id)
    if warehouse_id:
        stmt = stmt.where(InventoryTransaction.warehouse_id == warehouse_id)
    if tx_type:
        stmt = stmt.where(InventoryTransaction.type == tx_type)
    if ref_code:
        stmt = stmt.where(InventoryTransaction.ref_code.like(f"%{ref_code}%"))
    if start_date:
        stmt = stmt.where(InventoryTransaction.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        stmt = stmt.where(
            InventoryTransaction.created_at < datetime.combine(end_date, datetime.min.time())
            .replace(hour=23, minute=59, second=59)
        )

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(InventoryTransaction.created_at.desc(), InventoryTransaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [transaction_to_out(tx) for tx in rows], total


def transaction_to_out(tx: InventoryTransaction) -> TransactionOut:
    try:
        type_label = TransactionType(tx.type).label
    except ValueError:
        type_label = tx.type
    return TransactionOut(
        id=tx.id,
        type=tx.type,
        type_label=type_label,
        product_id=tx.product_id,
        product_name=tx.product_name,
        warehouse_id=tx.warehouse_id,
        warehouse_name=tx.warehouse_name,
        qty=int(tx.qty),
        before_qty=tx.before_qty,
        after_qty=tx.after_qty,
        ref_code=tx.ref_code,
        operator=tx.operator,
        remark=tx.remark,
        created_at=tx.created_at,
    )


def warehouse_stock_list(db: Session, warehouse_id: str) -> list[WarehouseStockRow]:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError(f"仓库不存在：{warehouse_id}")
    rows = db.execute(
        select(WarehouseStock, Product)
        .join(Product, Product.id == WarehouseStock.product_id)
        .where(WarehouseStock.warehouse_id == warehouse_id)
        .order_by(Product.code)
    ).all()
    result: list[WarehouseStockRow] = []
    for stock, product in rows:
        qty = int(stock.qty)
        status = stock_status_of(qty, int(product.safety_stock or 0))
        result.append(
            WarehouseStockRow(
                warehouse_id=warehouse.id,
                warehouse_code=warehouse.code,
                warehouse_name=warehouse.name,
                product_id=product.id,
                product_code=product.code,
                product_name=product.name,
                category=product.category,
                spec=product.spec,
                unit=product.unit,
                safety_stock=int(product.safety_stock or 0),
                qty=qty,
                status=status.value,
                status_label=status.label,
            )
        )
    return result


def product_inventory_detail(db: Session, product_id: str) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("商品不存在")
    total = product_total_qty(db, product_id)
    status = stock_status_of(total, int(product.safety_stock or 0))
    return {
        "product": {
            "id": product.id,
            "code": product.code,
            "name": product.name,
            "spec": product.spec,
            "unit": product.unit,
            "category": product.category,
            "safety_stock": int(product.safety_stock or 0),
            "purchase_price": str(product.purchase_price) if product.purchase_price else None,
        },
        "total_qty": total,
        "status": status.value,
        "status_label": status.label,
        "incoming_qty": incoming_qty(db, product_id),
        "warehouses": [item.model_dump() for item in product_warehouse_breakdown(db, product_id)],
    }


# --------------------------------------------------------------------------- #
# 补货测算
# --------------------------------------------------------------------------- #
def replenishment_for_product(db: Session, product_id: str) -> ReplenishmentResult:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("商品不存在")

    current = product_total_qty(db, product_id)
    incoming = incoming_qty(db, product_id)
    safety = int(product.safety_stock or 0)
    suggested = compute_replenishment(safety, current, incoming)

    supplier_id, supplier_name, price = _latest_purchase_reference(db, product_id)
    if price is None:
        price = product.purchase_price
    estimated = Decimal(str(price)) * suggested if price is not None else None

    evidence = [
        f"安全库存：{safety} {product.unit or ''}".strip(),
        f"当前可用库存：{current}（各仓库合计）",
        f"已审批未收货（在途）：{incoming}",
        f"现存低于安全库存的缺口：{max(safety - current, 0)}",
    ]
    if supplier_id:
        evidence.append(f"最近一次采购单价：￥{price}（{supplier_name}）")

    return ReplenishmentResult(
        product_id=product.id,
        product_code=product.code,
        product_name=product.name,
        unit=product.unit,
        safety_stock=safety,
        current_qty=current,
        incoming_qty=incoming,
        suggested_qty=suggested,
        formula=replenishment_formula_text(safety, current, incoming, suggested),
        explanation=(
            "按「建议采购量 = max(0, 安全库存 - 当前可用库存 - 已审批未收货数量)」计算；"
            "没有销售历史，不做需求预测。"
        ),
        evidence=evidence,
        reference_supplier_id=supplier_id,
        reference_supplier_name=supplier_name,
        reference_price=price,
        estimated_amount=estimated.quantize(Decimal("0.01")) if estimated is not None else None,
        calculated_at=datetime.now(),
    )


def _latest_purchase_reference(
    db: Session, product_id: str
) -> tuple[str | None, str | None, Decimal | None]:
    row = db.execute(
        select(PurchaseOrder.supplier_id, PurchaseOrder.supplier_name, PurchaseOrderItem.price)
        .join(PurchaseOrderItem, PurchaseOrderItem.po_id == PurchaseOrder.id)
        .where(
            PurchaseOrderItem.product_id == product_id,
            PurchaseOrder.status.not_in(
                (PurchaseOrderStatus.CANCELLED.value, PurchaseOrderStatus.REJECTED.value)
            ),
        )
        .order_by(PurchaseOrder.created_at.desc())
        .limit(1)
    ).first()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]
