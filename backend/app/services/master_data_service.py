"""主数据服务：供应商 / 商品 / 仓库。

约定：所有写操作只 ``flush``，由 API 层统一 ``commit``。
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.core.ids import gen_id
from app.models import (
    LogisticsEvent,
    LogisticsOrder,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
    Warehouse,
    WarehouseStock,
)
from app.models.enums import LogisticsStatus, MasterStatus, PurchaseOrderStatus
from app.schemas.master_data import (
    ProductCreate,
    ProductOut,
    ProductUpdate,
    SupplierCreate,
    SupplierDetail,
    SupplierOut,
    SupplierStatistics,
    SupplierUpdate,
    WarehouseCreate,
    WarehouseOut,
    WarehouseUpdate,
)
from app.services.rules import stock_status_of

OPEN_PO_STATUSES = (
    PurchaseOrderStatus.DRAFT.value,
    PurchaseOrderStatus.PENDING.value,
    PurchaseOrderStatus.APPROVED.value,
    PurchaseOrderStatus.PARTIAL.value,
)


# --------------------------------------------------------------------------- #
# 供应商
# --------------------------------------------------------------------------- #
def get_supplier(db: Session, supplier_id: str) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError("供应商不存在")
    return supplier


def supplier_to_out(supplier: Supplier) -> SupplierOut:
    return SupplierOut.model_validate(supplier)


def list_suppliers(
    db: Session,
    *,
    keyword: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[SupplierOut], int]:
    stmt = select(Supplier)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(Supplier.name.like(like), Supplier.code.like(like), Supplier.contact.like(like))
        )
    if status:
        stmt = stmt.where(Supplier.status == status)

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(Supplier.created_at.desc(), Supplier.code)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [supplier_to_out(item) for item in rows], total


def next_supplier_code(db: Session) -> str:
    """生成下一个供应商编码：沿用 ``SUP001`` 规则，跳过已占用的编号。"""
    existing = set(db.scalars(select(Supplier.code)).all())
    seq = 0
    for code in existing:
        tail = str(code)[3:] if str(code).upper().startswith("SUP") else ""
        if tail.isdigit():
            seq = max(seq, int(tail))
    while True:
        seq += 1
        candidate = f"SUP{seq:03d}"
        if candidate not in existing:
            return candidate


def create_supplier(db: Session, payload: SupplierCreate) -> Supplier:
    code = (payload.code or "").strip() or next_supplier_code(db)
    name = payload.name.strip()
    if db.scalar(select(func.count()).select_from(Supplier).where(Supplier.code == code)):
        raise ConflictError(f"供应商编码已存在：{code}", code="SUPPLIER_CODE_EXISTS")
    if db.scalar(select(func.count()).select_from(Supplier).where(Supplier.name == name)):
        raise ConflictError(f"供应商名称已存在：{name}", code="SUPPLIER_NAME_EXISTS")

    supplier = Supplier(
        id=gen_id("SUP", 16),
        code=code,
        name=name,
        contact=payload.contact,
        phone=payload.phone,
        categories=[item for item in payload.categories if item],
        address=payload.address,
        status=payload.status.value,
        remark=payload.remark,
    )
    db.add(supplier)
    db.flush()
    return supplier


def update_supplier(db: Session, supplier_id: str, payload: SupplierUpdate) -> Supplier:
    supplier = get_supplier(db, supplier_id)
    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] and data["name"].strip() != supplier.name:
        name = data["name"].strip()
        exists = db.scalar(
            select(func.count())
            .select_from(Supplier)
            .where(Supplier.name == name, Supplier.id != supplier.id)
        )
        if exists:
            raise ConflictError(f"供应商名称已存在：{name}", code="SUPPLIER_NAME_EXISTS")
        supplier.name = name

    for field in ("contact", "phone", "address", "remark"):
        if field in data:
            setattr(supplier, field, data[field])
    if "categories" in data and data["categories"] is not None:
        supplier.categories = [item for item in data["categories"] if item]
    if "status" in data and data["status"] is not None:
        supplier.status = _as_value(data["status"])

    db.flush()
    return supplier


def set_supplier_status(db: Session, supplier_id: str, status: str) -> Supplier:
    supplier = get_supplier(db, supplier_id)
    status = _as_value(status)
    if status == MasterStatus.DISABLED.value and supplier.is_active:
        open_orders = db.scalar(
            select(func.count())
            .select_from(PurchaseOrder)
            .where(
                PurchaseOrder.supplier_id == supplier.id,
                PurchaseOrder.status.in_(OPEN_PO_STATUSES),
            )
        )
        if open_orders:
            raise BusinessRuleError(
                f"该供应商还有 {open_orders} 张未完结的采购订单，不能停用",
                code="SUPPLIER_HAS_OPEN_ORDERS",
            )
    supplier.status = status
    db.flush()
    return supplier


def supplier_statistics(
    db: Session, supplier_id: str, min_sample: int | None = None
) -> SupplierStatistics:
    """供应商统计：准时交付率只统计「已完成且有预计到货时间」的订单。"""
    supplier = get_supplier(db, supplier_id)
    min_sample = settings.SUPPLIER_MIN_SAMPLE if min_sample is None else min_sample

    orders = db.scalars(
        select(PurchaseOrder).where(PurchaseOrder.supplier_id == supplier_id)
    ).all()
    completed = [o for o in orders if o.status == PurchaseOrderStatus.COMPLETED.value]
    in_progress = [
        o
        for o in orders
        if o.status in (PurchaseOrderStatus.APPROVED.value, PurchaseOrderStatus.PARTIAL.value)
    ]
    amount = sum(
        (Decimal(str(o.total_amount or 0)) for o in orders
         if o.status not in (PurchaseOrderStatus.CANCELLED.value, PurchaseOrderStatus.REJECTED.value)),
        Decimal("0"),
    )

    delayed_orders = 0
    if orders:
        delayed_orders = int(
            db.scalar(
                select(func.count())
                .select_from(LogisticsOrder)
                .where(
                    LogisticsOrder.po_id.in_([o.id for o in orders]),
                    LogisticsOrder.status != LogisticsStatus.DELIVERED.value,
                    LogisticsOrder.expected_arrival.is_not(None),
                    LogisticsOrder.expected_arrival < date.today(),
                )
            )
            or 0
        )

    sample_size = 0
    on_time_orders = 0
    if completed:
        # 只有「已签收」的物流单才可判定：在途/待发货的不能算作"未准时"，
        # 否则一张还在路上的单会被当成延迟，把准时率拉低。
        rows = db.execute(
            select(LogisticsOrder, func.max(LogisticsEvent.time))
            .outerjoin(LogisticsEvent, LogisticsEvent.logistics_id == LogisticsOrder.id)
            .where(
                LogisticsOrder.po_id.in_([o.id for o in completed]),
                LogisticsOrder.expected_arrival.is_not(None),
                LogisticsOrder.status == LogisticsStatus.DELIVERED.value,
            )
            .group_by(LogisticsOrder.id)
        ).all()
        for logistics, last_time in rows:
            sample_size += 1
            if last_time is not None and last_time.date() <= logistics.expected_arrival:
                on_time_orders += 1

    on_time_rate = round(on_time_orders / sample_size, 4) if sample_size else None
    # 口径：只要有过 1 单已交付（已签收）的订单，就能算出准时交付率，
    # 不要求大样本；只有一单都没交付过时才显示"数据不足"。
    has_enough_sample = sample_size >= max(min_sample, 1)
    if sample_size == 0:
        note = "数据不足（暂无已交付订单）"
    elif not has_enough_sample:
        note = f"数据不足（样本 {sample_size} 单，至少需要 {min_sample} 单）"
    else:
        note = (
            f"准时交付率 {on_time_rate:.0%}"
            f"（已交付 {sample_size} 单，其中准时 {on_time_orders} 单）"
            if on_time_rate is not None
            else ""
        )

    last_order_date = max((o.created_at.date() for o in orders), default=None)

    return SupplierStatistics(
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        total_orders=len(orders),
        completed_orders=len(completed),
        in_progress_orders=len(in_progress),
        delayed_orders=delayed_orders,
        sample_size=sample_size,
        on_time_orders=on_time_orders,
        on_time_rate=on_time_rate,
        has_enough_sample=has_enough_sample,
        total_purchase_amount=amount.quantize(Decimal("0.01")),
        last_order_date=last_order_date,
        note=note,
    )


def supplier_detail(db: Session, supplier_id: str) -> SupplierDetail:
    supplier = get_supplier(db, supplier_id)
    base = supplier_to_out(supplier)
    return SupplierDetail(**base.model_dump(), statistics=supplier_statistics(db, supplier_id))


def supplier_options(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Supplier).where(Supplier.status == MasterStatus.ACTIVE.value).order_by(Supplier.code)
    ).all()
    return [
        {"id": item.id, "code": item.code, "name": item.name, "categories": item.categories or []}
        for item in rows
    ]


# --------------------------------------------------------------------------- #
# 商品
# --------------------------------------------------------------------------- #
def get_product(db: Session, product_id: str) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("商品不存在")
    return product


def product_to_out(product: Product, total_qty: int = 0) -> ProductOut:
    status = stock_status_of(total_qty, int(product.safety_stock or 0))
    out = ProductOut.model_validate(product)
    out.total_qty = total_qty
    out.stock_status = status.value
    out.stock_status_label = status.label
    return out


def products_with_stock(db: Session, products: list[Product]) -> list[ProductOut]:
    from app.services.inventory_service import product_qty_map

    qty_map = product_qty_map(db, [item.id for item in products])
    return [product_to_out(item, qty_map.get(item.id, 0)) for item in products]


def list_products(
    db: Session,
    *,
    keyword: str | None = None,
    category: str | None = None,
    sub_category: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ProductOut], int]:
    stmt = select(Product)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Product.name.like(like), Product.code.like(like)))
    if category:
        stmt = stmt.where(Product.category == category)
    if sub_category:
        stmt = stmt.where(Product.sub_category == sub_category)
    if status:
        stmt = stmt.where(Product.status == status)

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(Product.code)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return products_with_stock(db, list(rows)), total


def create_product(db: Session, payload: ProductCreate) -> Product:
    code = payload.code.strip()
    if db.scalar(select(func.count()).select_from(Product).where(Product.code == code)):
        raise ConflictError(f"商品编码已存在：{code}", code="PRODUCT_CODE_EXISTS")

    product = Product(
        id=gen_id("P", 16),
        code=code,
        name=payload.name.strip(),
        category=payload.category,
        sub_category=payload.sub_category,
        spec=payload.spec,
        unit=payload.unit,
        safety_stock=payload.safety_stock,
        purchase_price=payload.purchase_price,
        status=payload.status.value,
    )
    db.add(product)
    db.flush()
    return product


def update_product(db: Session, product_id: str, payload: ProductUpdate) -> Product:
    product = get_product(db, product_id)
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "category", "sub_category", "spec", "unit", "safety_stock", "purchase_price"):
        if field in data:
            value = data[field]
            setattr(product, field, value.strip() if isinstance(value, str) else value)
    if "status" in data and data["status"] is not None:
        product.status = _as_value(data["status"])
    db.flush()
    return product


def set_product_status(db: Session, product_id: str, status: str) -> Product:
    product = get_product(db, product_id)
    status = _as_value(status)
    if status == MasterStatus.DISABLED.value and product.is_active:
        stock = db.scalar(
            select(func.coalesce(func.sum(WarehouseStock.qty), 0)).where(
                WarehouseStock.product_id == product.id
            )
        )
        if int(stock or 0) > 0:
            raise BusinessRuleError("该商品还有库存结存，不能停用", code="PRODUCT_HAS_STOCK")
        pending = db.scalar(
            select(func.count())
            .select_from(PurchaseOrderItem)
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.po_id)
            .where(
                PurchaseOrderItem.product_id == product.id,
                PurchaseOrder.status.in_(OPEN_PO_STATUSES),
            )
        )
        if pending:
            raise BusinessRuleError(
                f"该商品还有 {pending} 条未完结的采购明细，不能停用",
                code="PRODUCT_HAS_OPEN_ORDERS",
            )
    product.status = status
    db.flush()
    return product


def product_options(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Product).where(Product.status == MasterStatus.ACTIVE.value).order_by(Product.code)
    ).all()
    return [
        {
            "id": item.id,
            "code": item.code,
            "name": item.name,
            "spec": item.spec,
            "unit": item.unit,
            "category": item.category,
            "sub_category": item.sub_category,
            "safety_stock": int(item.safety_stock or 0),
            "purchase_price": str(item.purchase_price) if item.purchase_price is not None else None,
        }
        for item in rows
    ]


# --------------------------------------------------------------------------- #
# 仓库
# --------------------------------------------------------------------------- #
def get_warehouse(db: Session, warehouse_id: str) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError("仓库不存在")
    return warehouse


def warehouse_to_out(warehouse: Warehouse, total_qty: int = 0, sku_count: int = 0) -> WarehouseOut:
    out = WarehouseOut.model_validate(warehouse)
    out.total_qty = total_qty
    out.sku_count = sku_count
    return out


def _warehouse_stats(db: Session, warehouse_ids: list[str]) -> dict[str, tuple[int, int]]:
    if not warehouse_ids:
        return {}
    rows = db.execute(
        select(
            WarehouseStock.warehouse_id,
            func.coalesce(func.sum(WarehouseStock.qty), 0),
            func.count(WarehouseStock.id),
        )
        .where(WarehouseStock.warehouse_id.in_(warehouse_ids))
        .group_by(WarehouseStock.warehouse_id)
    ).all()
    return {row[0]: (int(row[1] or 0), int(row[2] or 0)) for row in rows}


def list_warehouses(
    db: Session,
    *,
    keyword: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[WarehouseOut], int]:
    stmt = select(Warehouse)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Warehouse.name.like(like), Warehouse.code.like(like)))
    if status:
        stmt = stmt.where(Warehouse.status == status)

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(Warehouse.code)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    stats = _warehouse_stats(db, [item.id for item in rows])
    items = [
        warehouse_to_out(item, *stats.get(item.id, (0, 0)))
        for item in rows
    ]
    return items, total


def create_warehouse(db: Session, payload: WarehouseCreate) -> Warehouse:
    code = payload.code.strip()
    if db.scalar(select(func.count()).select_from(Warehouse).where(Warehouse.code == code)):
        raise ConflictError(f"仓库编码已存在：{code}", code="WAREHOUSE_CODE_EXISTS")
    warehouse = Warehouse(
        id=gen_id("WH", 16),
        code=code,
        name=payload.name.strip(),
        address=payload.address,
        manager=payload.manager,
        phone=payload.phone,
        status=payload.status.value,
    )
    db.add(warehouse)
    db.flush()
    return warehouse


def update_warehouse(db: Session, warehouse_id: str, payload: WarehouseUpdate) -> Warehouse:
    warehouse = get_warehouse(db, warehouse_id)
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "address", "manager", "phone"):
        if field in data:
            value = data[field]
            setattr(warehouse, field, value.strip() if isinstance(value, str) else value)
    if "status" in data and data["status"] is not None:
        warehouse.status = _as_value(data["status"])
    db.flush()
    return warehouse


def set_warehouse_status(db: Session, warehouse_id: str, status: str) -> Warehouse:
    warehouse = get_warehouse(db, warehouse_id)
    status = _as_value(status)
    if status == MasterStatus.DISABLED.value and warehouse.is_active:
        stock = db.scalar(
            select(func.coalesce(func.sum(WarehouseStock.qty), 0)).where(
                WarehouseStock.warehouse_id == warehouse.id
            )
        )
        if int(stock or 0) > 0:
            raise BusinessRuleError("该仓库还有库存结存，不能停用", code="WAREHOUSE_HAS_STOCK")
    warehouse.status = status
    db.flush()
    return warehouse


def warehouse_options(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Warehouse).where(Warehouse.status == MasterStatus.ACTIVE.value).order_by(Warehouse.code)
    ).all()
    return [
        {"id": item.id, "code": item.code, "name": item.name, "manager": item.manager}
        for item in rows
    ]


# --------------------------------------------------------------------------- #
def _as_value(value) -> str:
    """枚举或字符串统一取字符串值。"""
    return getattr(value, "value", value)
