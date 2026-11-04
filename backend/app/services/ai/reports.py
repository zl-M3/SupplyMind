"""AI 分析报告生成器（确定性规则实现，不依赖大模型）。

三类报告与数据库 CHECK 约束 ``chk_report_type`` 对齐：

* ``replenishment``     库存分析与补货建议
* ``supplier_risk``     供应商风险分析
* ``logistics_anomaly`` 物流异常分析
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.schemas.ai import ReportContent
from app.services import (
    inventory_service,
    logistics_service,
    master_data_service,
    purchase_service,
)


def _payload(
    report_type: str,
    title: str,
    content: ReportContent,
    *,
    target_id: str | None = None,
    target_name: str | None = None,
) -> dict:
    return {
        "report_type": report_type,
        "title": title,
        "target_id": target_id,
        "target_name": target_name,
        "content": content,
    }


# --------------------------------------------------------------------------- #
# 库存与补货
# --------------------------------------------------------------------------- #
def inventory_report(db: Session, limit: int = 8) -> dict:
    summary = inventory_service.inventory_summary(db)
    alerts, total_alerts = inventory_service.inventory_alerts(db, page=1, page_size=limit)

    evidence = [
        f"共 {summary.total_sku} 个商品，库存总量 {summary.total_qty}，库存金额 ¥{summary.total_value}",
        f"正常 {summary.normal_count} 个，低库存 {summary.low_count} 个，缺货 {summary.out_of_stock_count} 个",
    ]

    suggestions: list[str] = []
    total_amount = Decimal("0")
    for alert in alerts:
        result = inventory_service.replenishment_for_product(db, alert.product_id)
        evidence.append(
            f"{alert.product_name}：当前 {alert.current_qty}，安全库存 {alert.safety_stock}，"
            f"缺口 {alert.shortage}，建议采购 {result.suggested_qty}"
        )
        if result.suggested_qty > 0:
            suggestions.append(
                f"为「{alert.product_name}」补货 {result.suggested_qty} 件（预计 ¥{result.estimated_amount}）"
            )
            total_amount += Decimal(str(result.estimated_amount or 0))

    if not suggestions:
        suggestions.append("暂无需要补货的商品，保持现有采购节奏")

    if summary.out_of_stock_count:
        conclusion = (
            f"有 {summary.out_of_stock_count} 个商品缺货、{summary.low_count} 个商品低于安全库存，"
            f"建议按安全库存口径补货，预计金额 ¥{total_amount.quantize(Decimal('0.01'))}。"
        )
    elif summary.low_count:
        conclusion = (
            f"有 {summary.low_count} 个商品低于安全库存，建议尽快补货，"
            f"预计金额 ¥{total_amount.quantize(Decimal('0.01'))}。"
        )
    else:
        conclusion = "所有商品库存均高于安全库存，库存水位健康。"

    content = ReportContent(
        conclusion=conclusion,
        evidence=evidence,
        cause=(
            f"按「库存为 0 即缺货、低于安全库存即低库存」的判定口径统计，{total_alerts} 个商品触发预警；"
            "补货量按「安全库存 - 当前库存 - 已审批未收货数量」测算，系统没有销售历史，不做需求预测。"
        ),
        suggestions=suggestions,
        actions=[
            "库存管理 → 库存预警 → 生成采购草稿",
            "AI 智能中心 → 对话提问「哪些商品需要补货」",
        ],
    )
    return _payload("replenishment", "库存分析与补货建议", content)


# --------------------------------------------------------------------------- #
# 供应商风险
# --------------------------------------------------------------------------- #
def supplier_risk_report(db: Session, supplier_id: str | None = None) -> dict:
    if supplier_id:
        detail = master_data_service.supplier_detail(db, supplier_id)
        stats = detail.statistics
        evidence = [
            f"{detail.name}（{detail.code}）：总订单 {stats.total_orders} 单，"
            f"已完成 {stats.completed_orders} 单，进行中 {stats.in_progress_orders} 单，延迟 {stats.delayed_orders} 单",
            f"准时交付统计：{stats.note}",
            f"累计采购金额 ¥{stats.total_purchase_amount}，最近下单 {stats.last_order_date or '无'}",
        ]
        if stats.has_enough_sample:
            rate = float(stats.on_time_rate or 0)
            level = "高风险" if rate < 70 else ("需关注" if rate < 85 else "表现良好")
            conclusion = f"{detail.name} 准时交付率 {rate}%，风险等级：{level}。"
            suggestions = (
                ["启动备选供应商询价，降低单一来源风险", "与供应商复盘延迟订单并提出改进时限"]
                if rate < 85
                else ["保持现有合作规模", "按月复核准时率趋势"]
            )
        else:
            conclusion = f"{detail.name} 的交付样本不足，暂不做准时率结论。"
            suggestions = [
                "继续积累 3 单以上的已完成订单后再评估",
                "当前以交付过程的异常节点为跟踪重点",
            ]
        return _payload(
            "supplier_risk",
            f"供应商风险分析：{detail.name}",
            ReportContent(
                conclusion=conclusion,
                evidence=evidence,
                cause="准时率仅统计「已完成订单且物流单存在预计到货时间」的样本，样本不足时不做推断。",
                suggestions=suggestions,
                actions=["供应商管理 → 供应商详情", "采购订单 → 按供应商筛选"],
            ),
            target_id=detail.id,
            target_name=detail.name,
        )

    suppliers, total = master_data_service.list_suppliers(db, page=1, page_size=20)
    evidence = []
    risky = []
    for supplier in suppliers:
        stats = master_data_service.supplier_statistics(db, supplier.id)
        if stats.has_enough_sample:
            evidence.append(
                f"{supplier.name}：准时率 {stats.on_time_rate}%，延迟 {stats.delayed_orders} 单，"
                f"进行中 {stats.in_progress_orders} 单"
            )
            if (stats.on_time_rate or 0) < 85:
                risky.append(supplier.name)
        else:
            evidence.append(f"{supplier.name}：{stats.note}")

    conclusion = (
        f"共评估 {total} 家供应商，其中 {len(risky)} 家准时率低于 85%：{'、'.join(risky)}。"
        if risky
        else f"共评估 {total} 家供应商，未发现准时率明显偏低的供应商。"
    )
    return _payload(
        "supplier_risk",
        "供应商交付风险总览",
        ReportContent(
            conclusion=conclusion,
            evidence=evidence or ["暂无供应商数据"],
            cause="风险按准时交付率低于 85% 判定，样本不足的供应商只做过程提示、不下结论。",
            suggestions=["优先关注低准时率供应商的在途订单", "对高风险供应商保留备选来源"],
            actions=["供应商管理 → 供应商列表", "AI 智能中心 → 对话提问供应商表现"],
        ),
    )


# --------------------------------------------------------------------------- #
# 物流异常
# --------------------------------------------------------------------------- #
def logistics_report(db: Session, logistics_id: str) -> dict:
    order = logistics_service.get_logistics(db, logistics_id)
    if order is None:
        raise NotFoundError("物流单不存在")
    dto = logistics_service.logistics_to_out(order)

    evidence = [
        f"物流单 {dto.code}（采购单 {dto.po_code}），承运商 {dto.carrier}，运单号 {dto.tracking_no}",
        f"当前状态 {dto.status_label}，预计到达 {dto.expected_arrival or '未填写'}",
    ]
    if dto.events:
        for event in dto.events[-3:]:
            evidence.append(
                f"{event.time:%Y-%m-%d %H:%M} {event.node}：{event.description or ''}"
                f"（{event.location or '未知地点'}）"
            )
    else:
        evidence.append("暂无物流轨迹节点")

    if dto.is_delayed:
        conclusion = f"物流单 {dto.code} 已延迟 {dto.delay_days} 天，需要立即处理。"
        suggestions = [
            f"联系 {dto.carrier} 核实到达时间，要求给出新的预计到达日期",
            "若延迟超过 3 天，与供应商协商拆单或改由其他仓库调拨",
            "同步通知需求方调整排产计划",
        ]
        cause = "物流单状态未到「已签收」，且当前日期已超过预计到达时间，按延迟规则判定为异常。"
    elif dto.status == "exception":
        conclusion = f"物流单 {dto.code} 处于异常状态，需要承运商给出处理方案。"
        suggestions = ["要求承运商提供书面异常说明与恢复时间", "评估是否需要重新发货"]
        cause = "承运商登记的节点中包含异常类描述，系统据此标记为异常单。"
    else:
        conclusion = f"物流单 {dto.code} 当前 {dto.status_label}，暂未发现异常。"
        suggestions = ["按计划跟踪在途状态", "到货后及时登记签收节点"]
        cause = "状态正常且未超过预计到达时间，没有触发延迟或异常规则。"

    return _payload(
        "logistics_anomaly",
        f"物流异常分析：{dto.code}",
        ReportContent(
            conclusion=conclusion,
            evidence=evidence,
            cause=cause,
            suggestions=suggestions,
            actions=["物流跟踪 → 物流详情", "物流详情 → 登记节点 / 刷新延迟"],
        ),
        target_id=dto.id,
        target_name=dto.code,
    )


# --------------------------------------------------------------------------- #
# 采购概览（供工作台与对话共用）
# --------------------------------------------------------------------------- #
def purchase_overview(db: Session) -> dict:
    pending = purchase_service.pending_count(db)
    orders, total = purchase_service.list_orders(db, page=1, page_size=5)
    evidence = [
        f"{order.code}（{order.supplier_name}）{order.status_label}，金额 ¥{order.total_amount}"
        for order in orders
    ]
    return {"pending": pending, "total": total, "evidence": evidence}


__all__ = [
    "inventory_report",
    "logistics_report",
    "purchase_overview",
    "supplier_risk_report",
]
