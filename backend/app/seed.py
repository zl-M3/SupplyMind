"""演示数据种子。

真实业务数据请勿使用本模块；它只在「空库 + AUTO_SEED_DEMO_DATA=true」时执行一次，
用来支撑 MVP 演示与三个必备 AI 场景：

1. 库存分析 + 补货建议（存在缺货商品 + 低库存商品）
2. 采购辅助（存在待审批 / 部分收货订单）
3. 物流异常分析（存在延迟与异常物流单）

表结构以 ``schema-mysql.sql`` 为准：主键为字符串 ID，数量列统一为 ``qty``。
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.ids import gen_id, next_code
from app.core.security import hash_password
from app.core.utils import utcnow
from app.models import (
    InventoryTransaction,
    LogisticsEvent,
    LogisticsOrder,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseReceipt,
    PurchaseReceiptItem,
    StockTransfer,
    Supplier,
    User,
    Warehouse,
    WarehouseStock,
)
from app.models.enums import (
    LogisticsStatus,
    MasterStatus,
    PurchaseOrderStatus,
    TransactionType,
    UserRole,
)

logger = logging.getLogger(__name__)

DEFAULT_PASSWORD = "123456"


def _days_ago(days: int, *, hour: int = 10, minute: int = 0) -> datetime:
    base = utcnow() - timedelta(days=days)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _today_offset(days: int) -> date:
    return (utcnow() + timedelta(days=days)).date()


SUPPLIERS = [
    ("SUP001", "深圳市恒通电子有限公司", "陈立", "0755-88886666", ["电子元件", "PCBA"]),
    ("SUP002", "东莞市精工五金制品厂", "刘敏", "0769-22334455", ["五金件", "结构件"]),
    ("SUP003", "苏州永盛包装材料有限公司", "王强", "0512-66778899", ["包装材料"]),
    ("SUP004", "宁波华远塑胶科技有限公司", "赵磊", "0574-87654321", ["塑胶件", "结构件"]),
    ("SUP005", "广州市天翼物流供应链有限公司", "孙丽", "020-38765432", ["物流服务"]),
    ("SUP006", "上海精测仪器有限公司", "周涛", "021-55667788", ["检测设备", "电子元件"]),
]

PRODUCTS = [
    ("P001", "主控芯片 STM32F103", "电子元件", "芯片", "LQFP48", "片", 500, "12.50"),
    ("P002", "贴片电阻 0603 10K", "电子元件", "被动器件", "0603", "个", 800, "0.02"),
    ("P003", "铝合金外壳 A 型", "结构件", "外壳结构", "120x80x30mm", "件", 300, "18.00"),
    ("P004", "螺丝 M3x8", "五金件", "紧固件", "M3x8", "个", 1000, "0.08"),
    ("P005", "瓦楞纸箱 中号", "包装材料", "纸箱", "400x300x250mm", "个", 600, "3.20"),
    ("P006", "电源适配器 12V2A", "电子元件", "电源器件", "12V/2A", "个", 200, "35.00"),
    ("P007", "ABS 塑料外壳 B 型", "塑胶件", "塑胶结构件", "150x90x40mm", "件", 400, "9.80"),
    ("P008", "散热片 60x60", "五金件", "散热件", "60x60x10mm", "片", 150, "6.50"),
    ("P009", "连接线束 200mm", "电子元件", "线束连接", "200mm", "条", 500, "1.80"),
    ("P010", "防静电包装袋", "包装材料", "防护包装", "200x300mm", "个", 250, "0.45"),
]

WAREHOUSES = [
    ("WH001", "深圳中心仓", "深圳市宝安区福永街道", "李明", "0755-88880001"),
    ("WH002", "东莞分仓", "东莞市长安镇振安路", "张华", "0769-22330002"),
    ("WH003", "上海前置仓", "上海市青浦区华新镇", "王芳", "021-55660003"),
]

# 期初库存：(商品编码, 仓库编码, 数量)
INITIAL_STOCK = [
    ("P001", "WH001", 120),
    ("P002", "WH001", 400),
    ("P002", "WH002", 320),
    ("P003", "WH001", 220),
    ("P003", "WH003", 60),
    ("P004", "WH001", 1800),
    ("P005", "WH001", 260),
    ("P005", "WH002", 150),
    ("P006", "WH001", 50),
    ("P008", "WH001", 120),
    ("P009", "WH002", 480),
    ("P010", "WH003", 70),
]


def seed_demo_data(db: Session) -> bool:
    """写入演示数据；已有采购单时直接跳过并返回 ``False``。"""
    if db.scalar(select(func.count()).select_from(PurchaseOrder)):
        return False

    now = utcnow()

    # ---------------- 用户 ----------------
    users = [
        ("gm", "张伟", UserRole.GM),
        ("sales01", "李娜", UserRole.SALES),
        ("sales02", "王强", UserRole.SALES),
    ]
    for username, display_name, role in users:
        if db.get(User, username) is None:
            db.add(
                User(
                    username=username,
                    password=hash_password(DEFAULT_PASSWORD),
                    display_name=display_name,
                    role=role.value,
                    status=1,
                )
            )
    db.flush()

    gm = "gm"
    sales = "sales01"

    # ---------------- 供应商 ----------------
    for code, name, contact, phone, categories in SUPPLIERS:
        if db.scalar(select(Supplier).where(Supplier.code == code)) is None:
            db.add(
                Supplier(
                    id=gen_id("SUP", 16),
                    code=code,
                    name=name,
                    contact=contact,
                    phone=phone,
                    categories=categories,
                    address="",
                    status=MasterStatus.ACTIVE.value,
                    remark="",
                    created_at=_days_ago(90),
                )
            )
    db.flush()

    supplier_by_code = {
        item.code: item for item in db.scalars(select(Supplier)).all()
    }

    # ---------------- 商品 ----------------
    for code, name, category, sub_category, spec, unit, safety, price in PRODUCTS:
        if db.scalar(select(Product).where(Product.code == code)) is None:
            db.add(
                Product(
                    id=gen_id("PRD", 16),
                    code=code,
                    name=name,
                    category=category,
                    sub_category=sub_category,
                    spec=spec,
                    unit=unit,
                    safety_stock=safety,
                    purchase_price=Decimal(price),
                    status=MasterStatus.ACTIVE.value,
                    created_at=_days_ago(90),
                )
            )
    db.flush()

    product_by_code = {item.code: item for item in db.scalars(select(Product)).all()}

    # ---------------- 仓库 ----------------
    for code, name, address, manager, phone in WAREHOUSES:
        if db.scalar(select(Warehouse).where(Warehouse.code == code)) is None:
            db.add(
                Warehouse(
                    id=gen_id("WH", 16),
                    code=code,
                    name=name,
                    address=address,
                    manager=manager,
                    phone=phone,
                    status=MasterStatus.ACTIVE.value,
                    created_at=_days_ago(90),
                )
            )
    db.flush()

    warehouse_by_code = {item.code: item for item in db.scalars(select(Warehouse)).all()}

    # ---------------- 期初库存 + 流水 ----------------
    for product_code, warehouse_code, qty in INITIAL_STOCK:
        product = product_by_code[product_code]
        warehouse = warehouse_by_code[warehouse_code]
        db.add(
            WarehouseStock(
                product_id=product.id,
                warehouse_id=warehouse.id,
                qty=qty,
                updated_at=_days_ago(30),
            )
        )
        db.add(
            InventoryTransaction(
                id=gen_id("TX", 24),
                type=TransactionType.PURCHASE_IN.value,
                product_id=product.id,
                product_name=product.name,
                warehouse_id=warehouse.id,
                warehouse_name=warehouse.name,
                qty=qty,
                before_qty=0,
                after_qty=qty,
                ref_code="期初建账",
                operator=gm,
                remark="演示数据期初库存",
                created_at=_days_ago(30),
            )
        )
    db.flush()

    # ---------------- 采购订单 ----------------
    def add_order(
        *,
        supplier_code: str,
        status: str,
        created_by: str,
        created_days_ago: int,
        expected_offset: int,
        items: list[tuple[str, int, str, int]],
        approver: str | None = None,
        approved_days_ago: int | None = None,
        reject_reason: str = "",
        remark: str = "",
    ) -> PurchaseOrder:
        supplier = supplier_by_code[supplier_code]
        order = PurchaseOrder(
            id=gen_id("PO", 32),
            code=next_code(db, PurchaseOrder, "code", "PO"),
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            status=status,
            total_amount=Decimal("0"),
            created_by=created_by,
            created_at=_days_ago(created_days_ago),
            expected_arrival=_today_offset(expected_offset),
            approver=approver,
            approved_at=_days_ago(approved_days_ago) if approved_days_ago is not None else None,
            reject_reason=reject_reason,
            remark=remark,
        )
        total = Decimal("0")
        for product_code, qty, price, received in items:
            product = product_by_code[product_code]
            amount = (Decimal(price) * qty).quantize(Decimal("0.01"))
            total += amount
            order.items.append(
                PurchaseOrderItem(
                    id=gen_id("POI", 32),
                    product_id=product.id,
                    product_name=product.name,
                    spec=product.spec,
                    unit=product.unit,
                    qty=qty,
                    received_qty=received,
                    price=Decimal(price),
                    amount=amount,
                )
            )
        order.total_amount = total
        db.add(order)
        db.flush()
        return order

    order1 = add_order(
        supplier_code="SUP001",
        status=PurchaseOrderStatus.COMPLETED.value,
        created_by=gm,
        created_days_ago=6,
        expected_offset=-2,
        items=[("P001", 500, "12.50", 500), ("P002", 200, "0.02", 200)],
        approver=gm,
        approved_days_ago=6,
        remark="常规补货",
    )
    order2 = add_order(
        supplier_code="SUP002",
        status=PurchaseOrderStatus.APPROVED.value,
        created_by=sales,
        created_days_ago=4,
        expected_offset=-4,
        items=[("P003", 200, "18.00", 0), ("P004", 1000, "0.08", 0)],
        approver=gm,
        approved_days_ago=4,
        remark="结构件补货",
    )
    order3 = add_order(
        supplier_code="SUP005",
        status=PurchaseOrderStatus.PARTIAL.value,
        created_by=sales,
        created_days_ago=3,
        expected_offset=2,
        items=[("P008", 100, "6.50", 40), ("P010", 50, "0.45", 0)],
        approver=gm,
        approved_days_ago=3,
        remark="分批到货",
    )
    add_order(
        supplier_code="SUP003",
        status=PurchaseOrderStatus.PENDING.value,
        created_by=sales,
        created_days_ago=1,
        expected_offset=6,
        items=[("P005", 500, "3.20", 0), ("P006", 100, "35.00", 0)],
        remark="等待 GM 审批",
    )
    add_order(
        supplier_code="SUP004",
        status=PurchaseOrderStatus.DRAFT.value,
        created_by=sales,
        created_days_ago=0,
        expected_offset=10,
        items=[("P007", 300, "9.80", 0)],
        remark="草稿：待确认单价",
    )
    add_order(
        supplier_code="SUP004",
        status=PurchaseOrderStatus.REJECTED.value,
        created_by=sales,
        created_days_ago=7,
        expected_offset=5,
        items=[("P009", 100, "1.80", 0)],
        approver=gm,
        approved_days_ago=7,
        reject_reason="报价高于上批次 8%，请重新议价后再提交",
        remark="被驳回",
    )

    # 部分收货订单补一张收货单
    receipt = PurchaseReceipt(
        id=gen_id("RC", 16),
        code=next_code(db, PurchaseReceipt, "code", "RC"),
        po_id=order3.id,
        warehouse_id=warehouse_by_code["WH001"].id,
        received_by=gm,
        received_at=_days_ago(1),
        remark="首批到货 40 件",
    )
    first_item = next(item for item in order3.items if item.product_name.startswith("散热片"))
    receipt.items.append(PurchaseReceiptItem(po_item_id=first_item.id, qty=40))
    db.add(receipt)

    # 已完成订单的入库流水
    wh001_id = warehouse_by_code["WH001"].id
    stock_target = {
        item.product_id: item
        for item in db.scalars(
            select(WarehouseStock).where(WarehouseStock.warehouse_id == wh001_id)
        ).all()
    }
    for item in order1.items:
        stock = stock_target.get(item.product_id)
        if stock is None:
            continue
        before = stock.qty
        stock.qty = before + item.received_qty
        db.add(
            InventoryTransaction(
                id=gen_id("TX", 24),
                type=TransactionType.PURCHASE_IN.value,
                product_id=item.product_id,
                product_name=item.product_name,
                warehouse_id=stock.warehouse_id,
                warehouse_name=warehouse_by_code["WH001"].name,
                qty=item.received_qty,
                before_qty=before,
                after_qty=stock.qty,
                ref_code=order1.code,
                operator=gm,
                remark="演示数据：采购入库",
                created_at=_days_ago(5),
            )
        )
    db.flush()

    # ---------------- 物流单 ----------------
    logistics1 = LogisticsOrder(
        id=gen_id("LG", 16),
        code=next_code(db, LogisticsOrder, "code", "LG"),
        po_id=order1.id,
        po_code=order1.code,
        supplier_id=order1.supplier_id,
        supplier_name=order1.supplier_name,
        carrier="顺丰速运",
        tracking_no="SF202610260001",
        expected_arrival=order1.expected_arrival,
        status=LogisticsStatus.DELIVERED.value,
        is_delayed=False,
        remark="",
    )
    logistics1.events = [
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(6, hour=9),
            node="已创建物流单",
            description="供应商已备货，等待揽收",
            location="深圳",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(6, hour=15),
            node="已揽收",
            description="顺丰已揽收",
            location="深圳宝安",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(5, hour=8),
            node="运输中",
            description="已到达广州中转场",
            location="广州",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(5, hour=14),
            node="已到达",
            description="已到达深圳中心仓",
            location="深圳",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(5, hour=16),
            node="已签收",
            description="收货人已签收",
            location="深圳",
        ),
    ]
    db.add(logistics1)

    logistics2 = LogisticsOrder(
        id=gen_id("LG", 16),
        code=next_code(db, LogisticsOrder, "code", "LG"),
        po_id=order2.id,
        po_code=order2.code,
        supplier_id=order2.supplier_id,
        supplier_name=order2.supplier_name,
        carrier="京东物流",
        tracking_no="JD202610290002",
        expected_arrival=order2.expected_arrival,
        status=LogisticsStatus.IN_TRANSIT.value,
        is_delayed=True,
        remark="预计到货已过期，系统标记延迟",
    )
    logistics2.events = [
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(4, hour=10),
            node="已创建物流单",
            description="东莞精工已发货",
            location="东莞",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(3, hour=9),
            node="运输中",
            description="干线运输中，途经广州中转场",
            location="广州",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(1, hour=20),
            node="运输中",
            description="车辆晚点，预计延后 2 天到达",
            location="广州",
        ),
    ]
    db.add(logistics2)

    logistics3 = LogisticsOrder(
        id=gen_id("LG", 16),
        code=next_code(db, LogisticsOrder, "code", "LG"),
        po_id=order3.id,
        po_code=order3.code,
        supplier_id=order3.supplier_id,
        supplier_name=order3.supplier_name,
        carrier="圆通速递",
        tracking_no="YT202610310003",
        expected_arrival=order3.expected_arrival,
        status=LogisticsStatus.EXCEPTION.value,
        is_delayed=False,
        remark="台风导致航班取消",
    )
    logistics3.events = [
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(3, hour=11),
            node="已创建物流单",
            description="广州天翼已出库",
            location="广州",
        ),
        LogisticsEvent(
            id=gen_id("LEV", 24),
            time=_days_ago(2, hour=15),
            node="异常",
            description="台风导致航班取消，预计整体延后 2 天",
            location="广州白云机场",
        ),
    ]
    db.add(logistics3)
    db.flush()

    order1.logistics_id = logistics1.id
    order2.logistics_id = logistics2.id
    order3.logistics_id = logistics3.id

    # ---------------- 调拨单 ----------------
    from_stock = next(
        item
        for item in db.scalars(select(WarehouseStock)).all()
        if item.product_id == product_by_code["P001"].id
        and item.warehouse_id == warehouse_by_code["WH001"].id
    )
    to_warehouse = warehouse_by_code["WH002"]
    move_qty = 20
    before_from = from_stock.qty
    from_stock.qty = before_from - move_qty
    target = db.scalar(
        select(WarehouseStock).where(
            WarehouseStock.product_id == product_by_code["P001"].id,
            WarehouseStock.warehouse_id == to_warehouse.id,
        )
    )
    if target is None:
        target = WarehouseStock(
            product_id=product_by_code["P001"].id,
            warehouse_id=to_warehouse.id,
            qty=0,
            updated_at=now,
        )
        db.add(target)
        db.flush()
    before_to = target.qty
    target.qty = before_to + move_qty

    transfer = StockTransfer(
        id=gen_id("TR", 16),
        code=next_code(db, StockTransfer, "code", "TR"),
        from_warehouse_id=warehouse_by_code["WH001"].id,
        from_warehouse_name=warehouse_by_code["WH001"].name,
        to_warehouse_id=to_warehouse.id,
        to_warehouse_name=to_warehouse.name,
        product_id=product_by_code["P001"].id,
        product_name=product_by_code["P001"].name,
        qty=move_qty,
        operator=gm,
        remark="深圳调拨至东莞，支援产线",
        created_at=_days_ago(1, hour=14),
    )
    db.add(transfer)
    db.add(
        InventoryTransaction(
            id=gen_id("TX", 24),
            type=TransactionType.TRANSFER_OUT.value,
            product_id=product_by_code["P001"].id,
            product_name=product_by_code["P001"].name,
            warehouse_id=warehouse_by_code["WH001"].id,
            warehouse_name=warehouse_by_code["WH001"].name,
            qty=-move_qty,
            before_qty=before_from,
            after_qty=from_stock.qty,
            ref_code=transfer.code,
            operator=gm,
            remark="调拨出库",
            created_at=_days_ago(1, hour=14),
        )
    )
    db.add(
        InventoryTransaction(
            id=gen_id("TX", 24),
            type=TransactionType.TRANSFER_IN.value,
            product_id=product_by_code["P001"].id,
            product_name=product_by_code["P001"].name,
            warehouse_id=to_warehouse.id,
            warehouse_name=to_warehouse.name,
            qty=move_qty,
            before_qty=before_to,
            after_qty=target.qty,
            ref_code=transfer.code,
            operator=gm,
            remark="调拨入库",
            created_at=_days_ago(1, hour=14),
        )
    )

    db.commit()
    logger.info("演示数据写入完成：订单 %s / 物流 %s / 调拨 %s", order1.code, logistics1.code, transfer.code)
    return True
