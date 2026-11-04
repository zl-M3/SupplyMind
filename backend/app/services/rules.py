"""纯业务规则（无数据库依赖，便于单测与复用）。

把这些口径集中在一处，是为了让「页面展示」「AI 工具」和「报告」引用同一套规则，
避免 AI 用不同口径编造结论。
"""

from __future__ import annotations

from decimal import Decimal

from app.models.enums import StockStatus


def stock_status_of(quantity: int, safety_stock: int) -> StockStatus:
    """库存状态规则（规划 2.3.C）。

    - 当前库存为 0 → 缺货
    - 当前库存 < 安全库存 → 低库存
    - 其他 → 正常
    """
    if quantity <= 0:
        return StockStatus.OUT_OF_STOCK
    if quantity < safety_stock:
        return StockStatus.LOW
    return StockStatus.NORMAL


def suggested_action_of(status: StockStatus) -> str:
    if status is StockStatus.OUT_OF_STOCK:
        return "立即补货：当前已缺货，建议优先下单并跟进到货时间"
    if status is StockStatus.LOW:
        return "尽快补货：低于安全库存，建议结合在途数量补充采购"
    return "库存充足，保持常规补货节奏"


def compute_replenishment(safety_stock: int, available: int, incoming: int) -> int:
    """建议采购量（规划 2.3.C 首期公式）。

    ``建议采购量 = max(0, 安全库存目标 - 当前可用库存 - 已审批未收货数量)``
    """
    return max(0, int(safety_stock) - int(available) - int(incoming))


def replenishment_formula_text(safety_stock: int, available: int, incoming: int, suggested: int) -> str:
    return (
        f"max(0, 安全库存 {safety_stock} - 当前库存 {available} - 在途未收货 {incoming}) = {suggested}"
    )


def delay_days_of(now, estimated_arrival) -> int:
    """延迟天数：仅当当前时间晚于预计到达时间时为正数。"""
    if estimated_arrival is None:
        return 0
    delta = now - estimated_arrival
    return max(0, delta.days)


def amount_of(quantity: int, unit_price: Decimal | float | int) -> Decimal:
    return (Decimal(str(unit_price)) * Decimal(int(quantity))).quantize(Decimal("0.01"))
