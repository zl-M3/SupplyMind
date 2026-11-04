"""库存调拨服务（一条调拨单只调拨一个商品）。

业务规则（规划 2.2.C）：校验调出仓库库存，确认后一次性扣减调出仓、增加调入仓，
并生成调拨记录与两条库存流水——全程同一事务。
"""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, NotFoundError
from app.core.ids import gen_id, next_code
from app.models import Product, StockTransfer, User, Warehouse
from app.models.enums import MasterStatus, TransactionType
from app.schemas.transfer import StockTransferCreate, StockTransferOut
from app.services.inventory_service import apply_stock_change, get_stock_row


def transfer_to_out(transfer: StockTransfer) -> StockTransferOut:
    return StockTransferOut.model_validate(transfer)


def get_transfer(db: Session, transfer_id: str) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise NotFoundError("调拨单不存在")
    return transfer


def list_transfers(
    db: Session, *, warehouse_id: str | None = None, page: int = 1, page_size: int = 20
) -> tuple[list[StockTransferOut], int]:
    stmt = select(StockTransfer)
    if warehouse_id:
        stmt = stmt.where(
            or_(
                StockTransfer.from_warehouse_id == warehouse_id,
                StockTransfer.to_warehouse_id == warehouse_id,
            )
        )
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(StockTransfer.created_at.desc(), StockTransfer.code.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [transfer_to_out(item) for item in rows], total


def create_transfer(db: Session, payload: StockTransferCreate, *, user: User) -> StockTransfer:
    if payload.from_warehouse_id == payload.to_warehouse_id:
        raise BusinessRuleError("调出仓库与调入仓库不能相同", code="SAME_WAREHOUSE")

    from_wh = db.get(Warehouse, payload.from_warehouse_id)
    if from_wh is None:
        raise NotFoundError("调出仓库不存在")
    to_wh = db.get(Warehouse, payload.to_warehouse_id)
    if to_wh is None:
        raise NotFoundError("调入仓库不存在")
    for warehouse in (from_wh, to_wh):
        if warehouse.status != MasterStatus.ACTIVE.value:
            raise BusinessRuleError(
                f"仓库「{warehouse.name}」已停用，不能参与调拨", code="WAREHOUSE_INACTIVE"
            )

    product = db.get(Product, payload.product_id)
    if product is None:
        raise NotFoundError("商品不存在")

    stock = get_stock_row(db, from_wh.id, product.id)
    available = int(stock.qty) if stock else 0
    if available < payload.qty:
        raise BusinessRuleError(
            f"「{from_wh.name}」中「{product.name}」库存不足：现有 {available}，需要 {payload.qty}",
            code="INSUFFICIENT_STOCK",
            detail={
                "product_id": product.id,
                "warehouse_id": from_wh.id,
                "available": available,
                "required": payload.qty,
            },
        )

    transfer = StockTransfer(
        id=gen_id("TR", 16),
        code=next_code(db, StockTransfer, "code", "TR"),
        from_warehouse_id=from_wh.id,
        from_warehouse_name=from_wh.name,
        to_warehouse_id=to_wh.id,
        to_warehouse_name=to_wh.name,
        product_id=product.id,
        product_name=product.name,
        qty=int(payload.qty),
        operator=user.username,
        remark=payload.remark,
    )
    db.add(transfer)
    db.flush()

    apply_stock_change(
        db,
        product_id=product.id,
        warehouse_id=from_wh.id,
        delta=-int(payload.qty),
        tx_type=TransactionType.TRANSFER_OUT,
        ref_code=transfer.code,
        remark=f"调拨出库至 {to_wh.name}",
        operator=user.username,
    )
    apply_stock_change(
        db,
        product_id=product.id,
        warehouse_id=to_wh.id,
        delta=int(payload.qty),
        tx_type=TransactionType.TRANSFER_IN,
        ref_code=transfer.code,
        remark=f"调拨入库自 {from_wh.name}",
        operator=user.username,
    )
    db.flush()
    return transfer
