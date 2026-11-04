"""Agent 工具集：7 个白名单工具。

设计要点（规划 3.2）：

* Agent 只能通过工具访问数据，工具内部复用业务服务，**不直接拼 SQL、不直连数据库**；
* 每个工具都按当前登录用户的角色做白名单校验（``ROLE_TOOLS``）；
* 写操作只生成草稿并进入确认流程（``create_purchase_draft`` 不写库）；
* 每次调用都记录名称、参数摘要、状态与耗时（``ToolCallLog``）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from time import perf_counter
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Product, User
from app.models.enums import UserRole
from app.schemas.ai import ConfirmationData, DraftItem, ToolCallLog, ToolInfo
from app.services import inventory_service, logistics_service, master_data_service, purchase_service
from app.services.ai.knowledge import search_knowledge


@dataclass
class ToolContext:
    """一次 Agent 运行期间共享的上下文。"""

    db: Session
    user: User
    tool_calls: list[ToolCallLog] = field(default_factory=list)
    confirmation: ConfirmationData | None = None


@dataclass(frozen=True)
class ToolSpec:
    name: str
    display_name: str
    description: str
    parameters: dict[str, Any]
    func: Callable[..., dict[str, Any]]
    requires_confirmation: bool = False

    def to_info(self) -> ToolInfo:
        return ToolInfo(
            name=self.name,
            display_name=self.display_name,
            description=self.description,
            requires_confirmation=self.requires_confirmation,
            parameters=self.parameters,
        )


# --------------------------------------------------------------------------- #
# 只读工具
# --------------------------------------------------------------------------- #
def query_inventory(
    ctx: ToolContext,
    keyword: str | None = None,
    category: str | None = None,
    status: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """按关键词/分类/状态查询库存总览。"""
    limit = max(1, min(int(limit or 10), 30))
    items, total = inventory_service.inventory_overview(
        ctx.db, keyword=keyword, category=category, status=status, page=1, page_size=limit
    )
    return {
        "total": total,
        "items": [
            {
                "product_id": item.product_id,
                "product_code": item.product_code,
                "product_name": item.product_name,
                "category": item.category,
                "unit": item.unit,
                "total_qty": item.total_qty,
                "safety_stock": item.safety_stock,
                "status": item.status,
                "status_label": item.status_label,
                "gap": item.gap,
                "warehouses": [wh.model_dump() for wh in item.warehouses],
            }
            for item in items
        ],
    }


def query_purchase_orders(
    ctx: ToolContext,
    keyword: str | None = None,
    status: str | None = None,
    supplier_id: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """查询采购订单列表（含金额、到货日期与收货进度）。"""
    limit = max(1, min(int(limit or 10), 30))
    orders, total = purchase_service.list_orders(
        ctx.db,
        keyword=keyword,
        status=status,
        supplier_id=supplier_id,
        page=1,
        page_size=limit,
    )
    return {
        "total": total,
        "items": [
            {
                "id": order.id,
                "code": order.code,
                "supplier_name": order.supplier_name,
                "status": order.status,
                "status_label": order.status_label,
                "total_amount": str(order.total_amount),
                "expected_arrival": order.expected_arrival.isoformat(),
                "ordered_qty": order.ordered_qty,
                "received_qty": order.received_qty,
                "remaining_qty": order.remaining_qty,
                "created_by": order.created_by,
            }
            for order in orders
        ],
    }


def query_supplier(
    ctx: ToolContext,
    keyword: str | None = None,
    supplier_id: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """查询供应商及其准时交付率（样本不足会明确说明数据不足）。"""
    if supplier_id:
        detail = master_data_service.supplier_detail(ctx.db, supplier_id)
        return {
            "supplier": detail.model_dump(mode="json"),
            "statistics": detail.statistics.model_dump(mode="json") if detail.statistics else None,
        }

    limit = max(1, min(int(limit or 10), 30))
    items, total = master_data_service.list_suppliers(
        ctx.db, keyword=keyword, page=1, page_size=limit
    )
    payload = []
    for item in items:
        stats = master_data_service.supplier_statistics(ctx.db, item.id)
        payload.append(
            {
                "id": item.id,
                "code": item.code,
                "name": item.name,
                "status": item.status,
                "status_label": item.status_label,
                "contact": item.contact,
                "phone": item.phone,
                "total_orders": stats.total_orders,
                "in_progress_orders": stats.in_progress_orders,
                "delayed_orders": stats.delayed_orders,
                "on_time_rate": stats.on_time_rate,
                "has_enough_sample": stats.has_enough_sample,
                "note": stats.note,
            }
        )
    return {"total": total, "items": payload}


def query_logistics(
    ctx: ToolContext,
    keyword: str | None = None,
    logistics_id: str | None = None,
    po_id: str | None = None,
    only_delayed: bool = False,
    limit: int = 10,
) -> dict[str, Any]:
    """查询物流单与轨迹节点，可只看延迟单。"""
    if logistics_id:
        order = logistics_service.get_logistics(ctx.db, logistics_id)
        return {"logistics": logistics_service.logistics_to_out(order).model_dump(mode="json")}

    limit = max(1, min(int(limit or 10), 30))
    items, total = logistics_service.list_logistics(
        ctx.db,
        keyword=keyword,
        only_delayed=bool(only_delayed),
        po_id=po_id,
        page=1,
        page_size=limit,
    )
    payload = []
    for order in items:
        payload.append(
            {
                "id": order.id,
                "code": order.code,
                "po_code": order.po_code,
                "supplier_name": order.supplier_name,
                "carrier": order.carrier,
                "tracking_no": order.tracking_no,
                "status": order.status,
                "status_label": order.status_label,
                "expected_arrival": order.expected_arrival.isoformat()
                if order.expected_arrival
                else None,
                "is_delayed": order.is_delayed,
                "delay_days": order.delay_days,
                "events": [event.model_dump(mode="json") for event in order.events],
            }
        )
    return {"total": total, "items": payload}


def calculate_replenishment(
    ctx: ToolContext,
    product_id: str | None = None,
    keyword: str | None = None,
    only_shortage: bool = True,
    limit: int = 5,
) -> dict[str, Any]:
    """按「安全库存 - 当前库存 - 在途未收货」测算建议采购量。"""
    if product_id:
        result = inventory_service.replenishment_for_product(ctx.db, product_id)
        return {"items": [result.model_dump(mode="json")]}

    limit = max(1, min(int(limit or 5), 20))
    candidates: list[str] = []
    if keyword:
        items, _total = inventory_service.inventory_overview(
            ctx.db, keyword=keyword, page=1, page_size=limit
        )
        candidates = [item.product_id for item in items]
    elif only_shortage:
        alerts, _total = inventory_service.inventory_alerts(ctx.db, page=1, page_size=limit)
        candidates = [item.product_id for item in alerts]
    else:
        items, _total = inventory_service.inventory_overview(ctx.db, page=1, page_size=limit)
        candidates = [item.product_id for item in items]

    results = []
    for candidate in candidates:
        # 停用商品不参与补货建议：否则草稿会带上停用商品，确认时必然失败
        product = ctx.db.get(Product, candidate)
        if product is None or not product.is_active:
            continue
        result = inventory_service.replenishment_for_product(ctx.db, candidate)
        if only_shortage and result.suggested_qty <= 0:
            continue
        results.append(result.model_dump(mode="json"))
    return {"items": results, "formula": "max(0, 安全库存 - 当前库存 - 已审批未收货数量)"}


def retrieve_business_knowledge(ctx: ToolContext, query: str, top_k: int = 3) -> dict[str, Any]:
    """检索采购、库存、供应商与物流的制度文档。"""
    top_k = max(1, min(int(top_k or 3), 8))
    hits = search_knowledge(query or "", top_k=top_k)
    return {"query": query, "hits": hits}


# --------------------------------------------------------------------------- #
# 写操作（仅生成草稿，入库需用户确认）
# --------------------------------------------------------------------------- #
def create_purchase_draft(
    ctx: ToolContext,
    items: list[dict[str, Any]],
    supplier_id: str | None = None,
    expected_arrival: str | None = None,
    reason: str = "",
) -> dict[str, Any]:
    """生成采购草稿（不写库），返回确认卡片。"""
    db = ctx.db
    if not items:
        raise AppError("采购草稿至少需要一个商品", code="DRAFT_ITEMS_REQUIRED")

    draft_items: list[DraftItem] = []
    basis: list[str] = []
    categories: dict[str, str | None] = {}
    for raw in items:
        product_id = str(raw.get("product_id") or "").strip()
        if not product_id:
            raise AppError("采购草稿缺少商品ID", code="DRAFT_PRODUCT_REQUIRED")
        product = master_data_service.get_product(db, product_id)
        if not product.is_active:
            raise AppError(
                f"商品「{product.name}」已停用，不能采购", code="PRODUCT_INACTIVE"
            )
        qty = int(raw.get("qty") or 0)
        if qty <= 0:
            raise AppError(
                f"「{product.name}」的采购数量必须大于 0", code="DRAFT_QTY_INVALID"
            )
        price = raw.get("price")
        price = Decimal(str(price)) if price is not None else product.purchase_price
        if price is None:
            raise AppError(
                f"「{product.name}」没有参考进价，请补充单价", code="DRAFT_PRICE_REQUIRED"
            )
        price = Decimal(str(price)).quantize(Decimal("0.01"))
        amount = (price * qty).quantize(Decimal("0.01"))
        draft_items.append(
            DraftItem(
                product_id=product.id,
                product_name=product.name,
                spec=product.spec,
                unit=product.unit,
                qty=qty,
                price=price,
                amount=amount,
            )
        )
        categories[product.id] = product.category
        if raw.get("basis"):
            basis.append(str(raw["basis"]))

    supplier_name: str | None = None
    dropped: list[str] = []
    if supplier_id:
        supplier = master_data_service.get_supplier(db, supplier_id)
        if not supplier.is_active:
            raise AppError(
                f"供应商「{supplier.name}」已停用，不能下单", code="SUPPLIER_INACTIVE"
            )
        supplier_name = supplier.name
        allowed = {str(item) for item in (supplier.categories or []) if item}
        if allowed:
            kept = [item for item in draft_items if categories.get(item.product_id) in allowed]
            dropped = [item.product_name for item in draft_items if item not in kept]
            draft_items = kept
    else:
        supplier_id, supplier_name, draft_items, dropped = _pick_supplier(
            db, draft_items, categories
        )

    if not draft_items:
        raise AppError(
            "这些商品没有可供应它们的合作公司（"
            + ("、".join(dropped) or "全部商品")
            + "），请先在「供应商管理」维护其主营商品大类",
            code="SUPPLIER_CATEGORY_MISMATCH",
        )
    if dropped:
        basis.append(f"以下商品不在该供应商的供货大类内，未纳入本单：{'、'.join(dropped)}")

    arrival = _parse_date(expected_arrival) or (date.today() + timedelta(days=7))
    total = sum((item.amount or Decimal("0") for item in draft_items), Decimal("0"))

    ctx.confirmation = ConfirmationData(
        action="create_purchase_draft",
        title="采购草稿确认",
        supplier_id=supplier_id,
        supplier_name=supplier_name,
        items=draft_items,
        total_amount=total.quantize(Decimal("0.01")),
        expected_arrival=arrival,
        reason=reason or "基于库存预警的补货建议",
        basis=basis,
    )
    return {
        "ok": True,
        "requires_confirmation": True,
        "draft": ctx.confirmation.model_dump(mode="json"),
    }


def _pick_supplier(
    db: Session, items: list[DraftItem], categories: dict[str, str | None]
) -> tuple[str | None, str | None, list[DraftItem], list[str]]:
    """选一家能覆盖最多草稿商品的供应商，并剔除它供应不了的商品。

    一张采购单只能挂一个供应商：AI 把多个品类的商品塞进同一张草稿时，
    必须按供应商的主营大类先收敛，否则确认写入时会被采购服务拒绝
    （SUPPLIER_CATEGORY_MISMATCH）。
    """
    best: tuple[int, str, str, list[DraftItem]] | None = None
    for option in master_data_service.supplier_options(db):
        allowed = {str(item) for item in (option.get("categories") or []) if item}
        covered = (
            list(items)
            if not allowed
            else [item for item in items if categories.get(item.product_id) in allowed]
        )
        if not covered:
            continue
        if best is None or len(covered) > best[0]:
            best = (len(covered), str(option["id"]), str(option["name"]), covered)

    if best is None:
        return None, None, [], [item.product_name for item in items]

    _, supplier_id, supplier_name, covered = best
    covered_ids = {item.product_id for item in covered}
    dropped = [item.product_name for item in items if item.product_id not in covered_ids]
    return supplier_id, supplier_name, covered, dropped


def _guess_supplier(db: Session, product_id: str) -> tuple[str | None, str | None]:
    """推荐供应商：优先该商品最近一次采购，其次第一个能供应此商品大类的供应商。

    供应商的主营大类必须覆盖商品大类，否则下单会被采购服务拒绝。
    """
    from sqlalchemy import select

    from app.models import Product, PurchaseOrder, PurchaseOrderItem, Supplier

    product = db.get(Product, product_id)
    category = product.category if product is not None else None

    rows = db.execute(
        select(PurchaseOrder.supplier_id, PurchaseOrder.supplier_name, Supplier.categories)
        .join(PurchaseOrderItem, PurchaseOrderItem.po_id == PurchaseOrder.id)
        .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
        .where(PurchaseOrderItem.product_id == product_id)
        .order_by(PurchaseOrder.created_at.desc())
    ).all()
    for supplier_id, supplier_name, categories in rows:
        allowed = [str(item) for item in (categories or []) if item]
        if not category or not allowed or category in allowed:
            return supplier_id, supplier_name

    options = master_data_service.supplier_options(db)
    for option in options:
        allowed = [str(item) for item in (option.get("categories") or []) if item]
        if not category or not allowed or category in allowed:
            return option["id"], option["name"]
    if options:
        return options[0]["id"], options[0]["name"]
    return None, None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# 供应商写操作（新增 / 批量导入 / 对账单）
# --------------------------------------------------------------------------- #
def create_supplier(
    ctx: ToolContext,
    name: str,
    contact: str | None = None,
    phone: str | None = None,
    categories: list[str] | None = None,
    address: str | None = None,
) -> dict[str, Any]:
    from app.models.enums import MasterStatus
    from app.schemas.master_data import SupplierCreate

    payload = SupplierCreate(
        name=name.strip(),
        contact=(contact or "").strip() or None,
        phone=(phone or "").strip() or None,
        categories=[item for item in (categories or []) if item],
        address=(address or "").strip() or "待补充",
        status=MasterStatus.ACTIVE,
    )
    supplier = master_data_service.create_supplier(ctx.db, payload)
    ctx.db.flush()
    return {
        "ok": True,
        "supplier_id": supplier.id,
        "code": supplier.code,
        "name": supplier.name,
    }


def batch_import_suppliers(ctx: ToolContext, rows: list[str]) -> dict[str, Any]:
    """每行：名称|联系人|电话|大类1,大类2"""
    import re as _re

    created: list[dict[str, Any]] = []
    failed: list[str] = []
    for raw in (rows or [])[:50]:
        parts = [part.strip() for part in _re.split(r"[|,，\t]", str(raw)) if part.strip()]
        if not parts:
            continue
        categories = (
            [item for item in _re.split(r"[、/]", parts[3]) if item] if len(parts) > 3 else []
        )
        try:
            created.append(
                create_supplier(
                    ctx,
                    parts[0],
                    parts[1] if len(parts) > 1 else None,
                    parts[2] if len(parts) > 2 else None,
                    categories,
                )
            )
        except Exception as exc:  # noqa: BLE001 - 单条失败继续
            failed.append(f"{parts[0]}：{exc}")
    return {"ok": True, "created": len(created), "items": created, "failed": failed}


def supplier_statement(ctx: ToolContext, supplier_name: str | None = None) -> dict[str, Any]:
    """按供应商汇总采购单数量与金额，生成对账单文本。"""
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from app.models import PurchaseOrder
    from app.models.enums import PurchaseOrderStatus

    stmt = _select(
        PurchaseOrder.supplier_name,
        _func.count(PurchaseOrder.id),
        _func.coalesce(_func.sum(PurchaseOrder.total_amount), 0),
    ).where(
        PurchaseOrder.status.not_in(
            (PurchaseOrderStatus.CANCELLED.value, PurchaseOrderStatus.REJECTED.value)
        )
    )
    if supplier_name:
        stmt = stmt.where(PurchaseOrder.supplier_name.like(f"%{supplier_name}%"))
    rows = ctx.db.execute(stmt.group_by(PurchaseOrder.supplier_name)).all()
    if not rows:
        return {"ok": True, "text": "没有查到可对账的采购单。", "rows": []}
    lines = [
        f"{name or '未知供应商'}：{int(count)} 单，金额 ¥{float(amount or 0):,.2f}"
        for name, count, amount in rows
    ]
    return {
        "ok": True,
        "text": "供应商对账单（不含已取消/已驳回）：\n" + "\n".join(lines),
        "rows": [
            {"supplier": name, "orders": int(count), "amount": float(amount or 0)}
            for name, count, amount in rows
        ],
    }


# --------------------------------------------------------------------------- #
# 注册表与调度
# --------------------------------------------------------------------------- #
TOOLS: dict[str, ToolSpec] = {
    "query_inventory": ToolSpec(
        name="query_inventory",
        display_name="查询库存",
        description="按关键词、分类或状态查询商品库存与各仓库结存，返回缺货/低库存状态。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "商品名称或编码关键词"},
                "category": {"type": "string", "description": "商品分类"},
                "status": {
                    "type": "string",
                    "enum": ["normal", "low", "out_of_stock"],
                    "description": "库存状态筛选",
                },
                "limit": {"type": "integer", "description": "返回条数，默认 10"},
            },
            "required": [],
        },
        func=query_inventory,
    ),
    "query_purchase_orders": ToolSpec(
        name="query_purchase_orders",
        display_name="查询采购订单",
        description="查询采购订单的编号、供应商、状态、金额、到货日期与收货进度。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "单号或备注关键词"},
                "status": {
                    "type": "string",
                    "enum": [
                        "draft",
                        "pending",
                        "approved",
                        "partial",
                        "completed",
                        "rejected",
                        "cancelled",
                    ],
                    "description": "单据状态",
                },
                "supplier_id": {"type": "string", "description": "供应商ID"},
                "limit": {"type": "integer", "description": "返回条数，默认 10"},
            },
            "required": [],
        },
        func=query_purchase_orders,
    ),
    "query_supplier": ToolSpec(
        name="query_supplier",
        display_name="查询供应商",
        description="查询供应商档案与准时交付率统计；样本不足时返回数据不足的说明。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "供应商名称、编码或联系人"},
                "supplier_id": {"type": "string", "description": "供应商ID，指定时返回详情"},
                "limit": {"type": "integer", "description": "返回条数，默认 10"},
            },
            "required": [],
        },
        func=query_supplier,
    ),
    "query_logistics": ToolSpec(
        name="query_logistics",
        display_name="查询物流",
        description="查询物流单状态、承运商、预计到达、延迟天数与轨迹节点。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "物流单号、运单号或供应商"},
                "logistics_id": {"type": "string", "description": "物流单ID，指定时返回详情"},
                "po_id": {"type": "string", "description": "按采购单ID过滤"},
                "only_delayed": {"type": "boolean", "description": "是否只看延迟单"},
                "limit": {"type": "integer", "description": "返回条数，默认 10"},
            },
            "required": [],
        },
        func=query_logistics,
    ),
    "calculate_replenishment": ToolSpec(
        name="calculate_replenishment",
        display_name="补货测算",
        description=(
            "按 max(0, 安全库存 - 当前可用库存 - 已审批未收货数量) 计算建议采购量；"
            "没有销售历史，不做需求预测。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "product_id": {"type": "string", "description": "指定商品ID"},
                "keyword": {"type": "string", "description": "商品名称或编码关键词"},
                "only_shortage": {"type": "boolean", "description": "是否只看需要补货的商品"},
                "limit": {"type": "integer", "description": "最多测算几个商品，默认 5"},
            },
            "required": [],
        },
        func=calculate_replenishment,
    ),
    "create_purchase_draft": ToolSpec(
        name="create_purchase_draft",
        display_name="生成采购草稿",
        description=(
            "生成采购订单草稿并等待用户确认；不会直接写入数据库，"
            "用户确认后由后端二次校验再落库。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "采购明细",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product_id": {"type": "string"},
                            "qty": {"type": "integer"},
                            "price": {"type": "number"},
                            "basis": {"type": "string", "description": "该行的数据依据"},
                        },
                        "required": ["product_id", "qty"],
                    },
                },
                "supplier_id": {"type": "string", "description": "供应商ID，不填则自动推荐"},
                "expected_arrival": {
                    "type": "string",
                    "description": "预计到货日期 YYYY-MM-DD",
                },
                "reason": {"type": "string", "description": "建单原因"},
            },
            "required": ["items"],
        },
        func=create_purchase_draft,
        requires_confirmation=True,
    ),
    "retrieve_business_knowledge": ToolSpec(
        name="retrieve_business_knowledge",
        display_name="检索制度文档",
        description="检索采购审批、库存预警、供应商管理与物流异常处理的内部规范。",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索问题"},
                "top_k": {"type": "integer", "description": "返回条数，默认 3"},
            },
            "required": ["query"],
        },
        func=retrieve_business_knowledge,
    ),
    "create_supplier": ToolSpec(
        name="create_supplier",
        display_name="新增供应商",
        description="新建一个供应商主数据（仅管理者），返回供应商编码。",
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "供应商名称"},
                "contact": {"type": "string", "description": "联系人"},
                "phone": {"type": "string", "description": "电话"},
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "主营大类",
                },
                "address": {"type": "string", "description": "地址"},
            },
            "required": ["name"],
        },
        func=create_supplier,
        requires_confirmation=True,
    ),
    "batch_import_suppliers": ToolSpec(
        name="batch_import_suppliers",
        display_name="批量导入供应商",
        description="按「名称|联系人|电话|大类1,大类2」每行一条批量导入供应商（仅管理者）。",
        parameters={
            "type": "object",
            "properties": {
                "rows": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "每行一条供应商信息",
                }
            },
            "required": ["rows"],
        },
        func=batch_import_suppliers,
        requires_confirmation=True,
    ),
    "supplier_statement": ToolSpec(
        name="supplier_statement",
        display_name="生成供应商对账单",
        description="按供应商汇总采购单数量与金额，生成对账单文本。",
        parameters={
            "type": "object",
            "properties": {
                "supplier_name": {"type": "string", "description": "供应商名称关键词，不填则全部"},
            },
            "required": [],
        },
        func=supplier_statement,
    ),
}

ROLE_TOOLS: dict[str, tuple[str, ...]] = {
    UserRole.GM.value: tuple(TOOLS.keys()),
    UserRole.SALES.value: (
        "query_purchase_orders",
        "query_logistics",
        "create_purchase_draft",
        "retrieve_business_knowledge",
    ),
}


def allowed_tools(user: User) -> list[str]:
    return list(ROLE_TOOLS.get(user.role, ()))


def tool_infos() -> list[dict[str, Any]]:
    return [spec.to_info().model_dump() for spec in TOOLS.values()]


def openai_tool_schemas(user: User) -> list[dict[str, Any]]:
    names = set(allowed_tools(user))
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            },
        }
        for spec in TOOLS.values()
        if spec.name in names
    ]


def _summarize(arguments: dict[str, Any], result: Any) -> str:
    try:
        text = json.dumps(arguments, ensure_ascii=False, default=str)
    except Exception:  # pragma: no cover - 参数无法序列化
        text = str(arguments)
    if len(text) > 160:
        text = text[:157] + "..."
    if isinstance(result, dict):
        extra = ""
        if "total" in result:
            extra = f"，共 {result['total']} 条"
        elif isinstance(result.get("items"), list):
            extra = f"，返回 {len(result['items'])} 条"
        return f"参数 {text}{extra}"
    return f"参数 {text}"


def call_tool(ctx: ToolContext, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """执行一次工具调用并记录日志；异常不打断对话。"""
    arguments = arguments or {}
    spec = TOOLS.get(name)
    started = perf_counter()

    if spec is None:
        log = ToolCallLog(
            name=name,
            arguments=arguments,
            status="failed",
            summary="未知工具",
            error="未注册的工具",
        )
        ctx.tool_calls.append(log)
        return {"error": f"未注册的工具：{name}"}

    if name not in allowed_tools(ctx.user):
        log = ToolCallLog(
            name=name,
            label=spec.display_name,
            arguments=arguments,
            status="rejected",
            summary="当前角色无权限调用该工具",
            error="PERMISSION_DENIED",
        )
        ctx.tool_calls.append(log)
        return {"error": f"当前角色无权调用工具 {name}"}

    try:
        result = spec.func(ctx, **arguments)
        duration = int((perf_counter() - started) * 1000)
        ctx.tool_calls.append(
            ToolCallLog(
                name=name,
                label=spec.display_name,
                arguments=arguments,
                status="success",
                duration_ms=duration,
                summary=_summarize(arguments, result),
            )
        )
        return result
    except AppError as exc:
        duration = int((perf_counter() - started) * 1000)
        ctx.tool_calls.append(
            ToolCallLog(
                name=name,
                label=spec.display_name,
                arguments=arguments,
                status="failed",
                duration_ms=duration,
                summary=_summarize(arguments, None),
                error=exc.message,
            )
        )
        return {"error": exc.message}
    except TypeError as exc:
        duration = int((perf_counter() - started) * 1000)
        ctx.tool_calls.append(
            ToolCallLog(
                name=name,
                label=spec.display_name,
                arguments=arguments,
                status="failed",
                duration_ms=duration,
                summary="参数不合法",
                error=str(exc),
            )
        )
        return {"error": f"参数不合法：{exc}"}
    except Exception as exc:  # pragma: no cover - 兜底，避免对话中断
        duration = int((perf_counter() - started) * 1000)
        ctx.tool_calls.append(
            ToolCallLog(
                name=name,
                label=spec.display_name,
                arguments=arguments,
                status="failed",
                duration_ms=duration,
                summary="工具执行异常",
                error=str(exc),
            )
        )
        return {"error": f"工具执行异常：{exc}"}
