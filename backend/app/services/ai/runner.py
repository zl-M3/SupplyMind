"""Agent 执行器：LLM 工具循环 + 规则引擎兜底。

统一出口是 ``run_agent``：配置了 ``OPENAI_API_KEY`` 时走大模型工具调用，
调用失败或未配置时自动降级到规则引擎，保证离线也能演示三个核心场景。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import User
from app.schemas.ai import ConfirmationData, ToolCallLog
from app.services.ai.prompts import SYSTEM_PROMPT, context_hint
from app.services.ai.tools import ToolContext, call_tool, openai_tool_schemas

logger = logging.getLogger(__name__)

SECTION_TITLES = ("结论", "数据依据", "原因分析", "建议动作", "可执行操作")


@dataclass
class AgentResult:
    answer: str
    mode: str = "rule"
    intent: str = "general"
    tool_calls: list[ToolCallLog] = field(default_factory=list)
    confirmation: ConfirmationData | None = None
    citations: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# 渲染
# --------------------------------------------------------------------------- #
def _bullets(items: list[str]) -> str:
    if not items:
        return "- 暂无"
    return "\n".join(f"- {item}" for item in items)


def render_answer(
    conclusion: str,
    evidence: list[str],
    cause: str,
    suggestions: list[str],
    actions: list[str],
) -> str:
    """按固定五段结构渲染 Markdown 回答。"""
    return (
        f"### 结论\n{conclusion.strip()}\n\n"
        f"### 数据依据\n{_bullets(evidence)}\n\n"
        f"### 原因分析\n{cause.strip() or '暂无'}\n\n"
        f"### 建议动作\n{_bullets(suggestions)}\n\n"
        f"### 可执行操作\n{_bullets(actions)}"
    )


# --------------------------------------------------------------------------- #
# 意图识别
# --------------------------------------------------------------------------- #
_KEYWORDS: dict[str, tuple[str, ...]] = {
    "replenishment": (
        "补货",
        "补多少",
        "采购多少",
        "建议采购",
        "安全库存",
        "缺货",
        "库存不足",
        "低于安全库存",
        "库存告急",
        "短缺",
        "不够卖",
        "备货",
    ),
    "logistics": (
        "物流",
        "运输",
        "到货",
        "签收",
        "延迟",
        "迟到",
        "运单",
        "快递",
        "发货",
        "在途",
        "轨迹",
    ),
    "supplier": ("供应商", "准时", "交付率", "交期", "合作方", "厂家", "评估"),
    "purchase": ("采购单", "采购订单", "审批", "下单", "草稿", "开单", "订单状态"),
    "knowledge": ("制度", "规范", "流程", "规定", "审批权限", "怎么办", "标准", "政策"),
    "inventory": ("库存", "结存", "仓库", "存货", "库存量", "实时库存"),
}

_PRIORITY = ("replenishment", "logistics", "supplier", "purchase", "knowledge", "inventory")

# 「生成采购草稿」类说法 + 库存缺口词 → 走补货分支
# （否则「采购」两个字会把意图抢到采购订单查询，草稿卡片永远出不来）
_SHORTAGE_WORDS = ("补货", "库存不足", "缺货", "安全库存", "低于安全库存", "库存告急", "备货")
_DRAFT_WORDS = ("生成", "草稿", "下单", "开单", "采购单", "帮我采购")

# 制度类提问优先走知识库：否则「采购审批需要什么权限」会被当成订单查询
_KNOWLEDGE_HINTS = ("制度", "规范", "流程", "规定", "审批权限", "权限", "政策", "标准", "怎么办")
_BIZ_HINTS = ("库存", "补货", "物流", "供应商", "采购单", "订单")


def detect_intent(text: str) -> str:
    """按关键词打分识别意图，分高者胜，同分按 _PRIORITY 优先。"""
    if any(word in text for word in _DRAFT_WORDS) and any(
        word in text for word in _SHORTAGE_WORDS
    ):
        return "replenishment"
    if any(word in text for word in _KNOWLEDGE_HINTS) and not any(
        word in text for word in _BIZ_HINTS
    ):
        return "knowledge"

    scores: dict[str, int] = {}
    for intent, words in _KEYWORDS.items():
        score = sum(1 for word in words if word in text)
        if score:
            scores[intent] = score
    if not scores:
        return "inventory"
    return max(scores.items(), key=lambda kv: (kv[1], -_PRIORITY.index(kv[0])))[0]


def _match_product_keyword(db: Session, text: str) -> str | None:
    """从用户问题里匹配商品名称或编码，找不到返回 None。"""
    from app.services.master_data_service import list_products

    products, _total = list_products(db, page=1, page_size=200)
    best: tuple[int, str] | None = None
    for product in products:
        for token in (product.name, product.code):
            if token and token in text:
                length = len(token)
                if best is None or length > best[0]:
                    best = (length, product.id)
    return best[1] if best else None


# --------------------------------------------------------------------------- #
# 规则分支
# --------------------------------------------------------------------------- #
def _rule_replenishment(ctx: ToolContext, text: str) -> AgentResult:
    product_id = _match_product_keyword(ctx.db, text)
    payload = call_tool(
        ctx,
        "calculate_replenishment",
        {"product_id": product_id, "only_shortage": True, "limit": 5} if product_id else {
            "only_shortage": True,
            "limit": 5,
        },
    )
    items = payload.get("items") or []

    if not items:
        return AgentResult(
            answer=render_answer(
                "当前没有需要补货的商品，库存水位正常。",
                ["库存总览中所有商品均不低于安全库存"],
                "各商品当前库存已达到或超过安全库存目标，且没有处于缺货状态。",
                ["保持每周巡检库存预警列表", "关注季节性或促销带来的需求波动"],
                ["库存管理 → 库存预警"],
            ),
            intent="replenishment",
            tool_calls=ctx.tool_calls,
        )

    evidence = []
    suggestions = []
    for item in items:
        evidence.append(
            f"{item['product_name']}：当前库存 {item['current_qty']} {item['unit'] or ''}，"
            f"安全库存 {item['safety_stock']}，在途未收 {item['incoming_qty']}，"
            f"建议采购 {item['suggested_qty']}"
        )
        suggestions.append(f"为「{item['product_name']}」补货 {item['suggested_qty']} 件")

    total_amount = sum(
        (Decimal(str(item.get("estimated_amount") or 0)) for item in items), Decimal("0")
    )
    conclusion = (
        f"共有 {len(items)} 个商品低于安全库存，合计建议采购 {sum(int(i['suggested_qty']) for i in items)} 件，"
        f"预计金额约 ¥{total_amount.quantize(Decimal('0.01'))}。"
    )
    cause = (
        "按「安全库存 - 当前可用库存 - 已审批未收货数量」口径测算，上述商品当前与在途合计仍低于安全库存；"
        "系统内没有销售历史数据，因此不做需求预测，仅按安全库存补足。"
    )

    want_draft = any(word in text for word in ("生成", "草稿", "下单", "创建采购", "开单", "帮我采购"))
    actions = ["库存预警 → 查看缺口明细", "点击「生成采购草稿」后由审批人确认"]
    confirmation: ConfirmationData | None = None

    if want_draft:
        draft_items = [
            {"product_id": item["product_id"], "qty": int(item["suggested_qty"])}
            for item in items
            if item.get("suggested_qty")
        ]
        draft = call_tool(
            ctx,
            "create_purchase_draft",
            {"items": draft_items, "reason": "库存低于安全库存，按安全库存口径补货"},
        )
        if draft.get("ok"):
            confirmation = ctx.confirmation
            actions = ["确认下方草稿卡片后系统将写入采购订单（草稿态）", "采购订单 → 提交审批"]
        else:
            actions = [f"生成草稿失败：{draft.get('error')}", "请手动在采购订单页新建"]

    return AgentResult(
        answer=render_answer(conclusion, evidence, cause, suggestions, actions),
        intent="replenishment",
        tool_calls=ctx.tool_calls,
        confirmation=confirmation,
    )


def _rule_logistics(ctx: ToolContext, text: str) -> AgentResult:
    payload = call_tool(ctx, "query_logistics", {"only_delayed": True, "limit": 5})
    delayed = payload.get("items") or []

    if not delayed:
        normal = call_tool(ctx, "query_logistics", {"limit": 5})
        items = normal.get("items") or []
        evidence = [
            f"{item['code']}（采购单 {item['po_code']}）状态 {item['status_label']}，预计到达 {item['expected_arrival']}"
            for item in items
        ]
        return AgentResult(
            answer=render_answer(
                "当前没有延迟的物流单。",
                evidence or ["系统中暂无物流单"],
                "所有未签收的物流单预计到达时间都未过期，没有触发延迟规则。",
                ["继续按计划跟踪在途单", "签收时及时登记节点，保证数据完整"],
                ["物流跟踪 → 物流列表"],
            ),
            intent="logistics",
            tool_calls=ctx.tool_calls,
        )

    evidence = [
        f"{item['code']}（采购单 {item['po_code']}，{item['supplier_name']}）预计 {item['expected_arrival']}，"
        f"已延迟 {item['delay_days']} 天，最新节点：{(item['events'][-1]['node'] if item['events'] else '无')}"
        for item in delayed
    ]
    suggestions = [
        f"联系 {item['carrier']} 核实 {item['tracking_no']} 的到达时间" for item in delayed
    ]
    suggestions.append("若确认无法按期到达，评估是否需要拆单从其他供应商补货")
    return AgentResult(
        answer=render_answer(
            f"有 {len(delayed)} 张物流单已延迟，最长延迟 {max(int(i['delay_days'] or 0) for i in delayed)} 天。",
            evidence,
            "物流单状态未到「已签收」，且当前日期已超过预计到达时间，按规则标记为延迟；"
            "延迟会直接影响采购单的可收货时间与库存补货节奏。",
            suggestions,
            ["物流跟踪 → 只看延迟", "物流详情 → 登记异常节点或联系承运商"],
        ),
        intent="logistics",
        tool_calls=ctx.tool_calls,
    )


def _rule_supplier(ctx: ToolContext, text: str) -> AgentResult:
    payload = call_tool(ctx, "query_supplier", {"limit": 5})
    items = payload.get("items") or []
    if not items:
        return AgentResult(
            answer=render_answer(
                "系统中暂无供应商数据。",
                ["供应商列表为空"],
                "尚未维护供应商档案，无法评估交付表现。",
                ["先在供应商管理中录入供应商"],
                ["供应商管理 → 新建供应商"],
            ),
            intent="supplier",
            tool_calls=ctx.tool_calls,
        )

    evidence = []
    risk = []
    for item in items:
        if item["has_enough_sample"]:
            evidence.append(
                f"{item['name']}：订单 {item['total_orders']} 单，进行中 {item['in_progress_orders']} 单，"
                f"延迟 {item['delayed_orders']} 单，准时率 {item['on_time_rate']}%"
            )
            if item["on_time_rate"] is not None and item["on_time_rate"] < 80:
                risk.append(f"{item['name']} 准时率仅 {item['on_time_rate']}%，建议约谈并保留备选供应商")
        else:
            evidence.append(f"{item['name']}：{item['note']}")

    conclusion = (
        f"共 {payload.get('total', len(items))} 家供应商，其中 {len(risk)} 家准时率偏低。"
        if risk
        else f"共 {payload.get('total', len(items))} 家供应商，整体交付表现正常。"
    )
    return AgentResult(
        answer=render_answer(
            conclusion,
            evidence,
            "准时率按「已完成订单且存在预计到货时间」的样本统计，样本不足时不给出比率，避免误判。",
            risk or ["保持现有采购节奏，定期复核供应商评分"],
            ["供应商管理 → 查看统计", "供应商详情 → 历史订单"],
        ),
        intent="supplier",
        tool_calls=ctx.tool_calls,
    )


def _rule_purchase(ctx: ToolContext, text: str) -> AgentResult:
    payload = call_tool(ctx, "query_purchase_orders", {"limit": 5})
    items = payload.get("items") or []
    evidence = [
        f"{item['code']}（{item['supplier_name']}）{item['status_label']}，金额 ¥{item['total_amount']}，"
        f"预计到货 {item['expected_arrival']}，已收 {item['received_qty']}/{item['ordered_qty']}"
        for item in items
    ]
    pending = [item for item in items if item["status"] == "pending"]
    return AgentResult(
        answer=render_answer(
            f"最近 {len(items)} 张采购订单中有 {len(pending)} 张待审批。",
            evidence or ["暂无采购订单"],
            "待审批单需要由非创建人的 GM 账号审批后才能创建物流单并收货。",
            ["优先处理待审批单，避免影响补货计划", "到货前确认物流单已创建并填写预计到达时间"],
            ["采购订单 → 待审批筛选", "采购订单详情 → 审批/收货"],
        ),
        intent="purchase",
        tool_calls=ctx.tool_calls,
    )


def _rule_knowledge(ctx: ToolContext, text: str) -> AgentResult:
    payload = call_tool(ctx, "retrieve_business_knowledge", {"query": text, "top_k": 3})
    hits = payload.get("hits") or []
    if not hits:
        return AgentResult(
            answer=render_answer(
                "没有检索到相关制度条款。",
                ["知识库检索无命中"],
                "提问可能超出内部制度文档范围。",
                ["换一种说法，或直接查看系统设置中的流程说明"],
                ["AI 智能中心 → 知识问答"],
            ),
            intent="knowledge",
            tool_calls=ctx.tool_calls,
        )

    evidence = [f"《{hit['title']}》{hit['section']}：{hit['content'][:120]}" for hit in hits]
    return AgentResult(
        answer=render_answer(
            f"检索到 {len(hits)} 条相关制度条款，来自《{hits[0]['title']}》。",
            evidence,
            "以上条款取自内部业务制度文档，按相关度排序。",
            ["按制度规定的责任人与时限执行", "如条款与系统配置冲突，以系统配置为准"],
            ["AI 智能中心 → 知识问答", "系统设置 → 参数配置"],
        ),
        intent="knowledge",
        tool_calls=ctx.tool_calls,
        citations=[
            {
                "title": hit["title"],
                "section": hit["section"],
                "score": hit["score"],
                "snippet": hit["content"][:160],
            }
            for hit in hits
        ],
    )


def _rule_inventory(ctx: ToolContext, text: str) -> AgentResult:
    payload = call_tool(ctx, "query_inventory", {"limit": 8})
    items = payload.get("items") or []
    shortage = [item for item in items if item["status"] == "out_of_stock"]
    low = [item for item in items if item["status"] == "low"]
    evidence = [
        f"{item['product_name']}：{item['total_qty']} {item['unit'] or ''}（安全库存 {item['safety_stock']}，{item['status_label']}）"
        for item in items
    ]
    if shortage:
        conclusion = f"有 {len(shortage)} 个商品缺货、{len(low)} 个商品低库存，需要立即补货。"
    elif low:
        conclusion = f"有 {len(low)} 个商品低于安全库存，建议尽快安排补货。"
    else:
        conclusion = "当前库存水位正常，没有缺货或低库存商品。"

    return AgentResult(
        answer=render_answer(
            conclusion,
            evidence or ["暂无库存数据"],
            "库存状态按「库存为 0 即缺货、低于安全库存即低库存」判定，统计口径为所有仓库合计。",
            ["缺货商品优先补货", "关注低库存商品的到货节奏"],
            ["库存管理 → 库存总览", "库存管理 → 库存预警"],
        ),
        intent="inventory",
        tool_calls=ctx.tool_calls,
    )


_RULE_HANDLERS = {
    "replenishment": _rule_replenishment,
    "logistics": _rule_logistics,
    "supplier": _rule_supplier,
    "purchase": _rule_purchase,
    "knowledge": _rule_knowledge,
    "inventory": _rule_inventory,
}


def _rule_supplier_ops(ctx: ToolContext, text: str) -> AgentResult:
    """供应商写操作：新增 / 批量导入 / 对账单（规则版，不依赖 LLM）。"""
    def grab(label: str) -> str | None:
        match = re.search(label + r"\s*[=:：]\s*([^\s，,；;]+)", text)
        return match.group(1) if match else None

    if "对账单" in text:
        payload = call_tool(ctx, "supplier_statement", {})
        rows = payload.get("rows") or []
        evidence = [
            f"{row['supplier']}：{row['orders']} 单，金额 ¥{row['amount']:,.2f}" for row in rows
        ]
        return AgentResult(
            answer=render_answer(
                "已按供应商汇总采购金额。",
                evidence or ["暂无可对账的采购单"],
                "对账口径：未取消、未驳回的采购单按供应商合计。",
                ["需要明细可到「采购订单」按供应商筛选"],
                ["采购订单 → 筛选供应商"],
            ),
            intent="supplier",
            tool_calls=ctx.tool_calls,
        )

    if "导入供应商" in text:
        tail = text.split("导入供应商", 1)[-1]
        rows = [seg.strip(" ：:") for seg in re.split(r"[；;\n]", tail) if "|" in seg]
        if not rows:
            return AgentResult(
                answer=render_answer(
                    "批量导入要按「名称|联系人|电话|大类1,大类2」一行一条。",
                    ["没有解析到有效数据行"],
                    "缺少可导入的数据。",
                    ["先整理成一行的格式再发给我"],
                    ["供应商管理 → 新建供应商"],
                ),
                intent="supplier",
                tool_calls=ctx.tool_calls,
            )
        payload = call_tool(ctx, "batch_import_suppliers", {"rows": rows})
        evidence = [f"已导入 {payload.get('created', 0)} 家"]
        evidence += [f"失败：{item}" for item in payload.get("failed") or []]
        return AgentResult(
            answer=render_answer(
                f"批量导入完成，新增 {payload.get('created', 0)} 家供应商。",
                evidence,
                "按每行一条解析；重名或编码冲突的行会跳过。",
                ["到供应商管理核对导入结果"],
                ["供应商管理"],
            ),
            intent="supplier",
            tool_calls=ctx.tool_calls,
        )

    name = grab("名称") or grab("供应商")
    if not name:
        return AgentResult(
            answer=render_answer(
                "新增供应商至少要给名称，例如：新增供应商 名称=宁波华远塑胶 联系人=赵磊 电话=0574-8888 大类=塑胶件,五金件",
                ["未解析到供应商名称"],
                "缺少关键字段。",
                ["按示例补充名称后重试"],
                ["供应商管理 → 新建供应商"],
            ),
            intent="supplier",
            tool_calls=ctx.tool_calls,
        )

    categories = [item for item in re.split(r"[、,，/]", grab("大类") or "") if item]
    payload = call_tool(
        ctx,
        "create_supplier",
        {
            "name": name,
            "contact": grab("联系人"),
            "phone": grab("电话"),
            "categories": categories,
        },
    )
    if not payload.get("ok"):
        return AgentResult(
            answer=render_answer(
                f"新增供应商失败：{payload.get('error')}",
                [],
                "可能是重名或参数不合法。",
                ["换一个名称，或到供应商管理手动新建"],
                ["供应商管理"],
            ),
            intent="supplier",
            tool_calls=ctx.tool_calls,
        )
    return AgentResult(
        answer=render_answer(
            f"已新增供应商「{payload['name']}」，编码 {payload['code']}。",
            [f"供应商 ID：{payload['supplier_id']}"],
            "已写入供应商主数据，状态为合作中。",
            ["到供应商管理补充地址与备注"],
            ["供应商管理"],
        ),
        intent="supplier",
        tool_calls=ctx.tool_calls,
    )


def run_rule_engine(ctx: ToolContext, text: str) -> AgentResult:
    if any(key in text for key in ("新增供应商", "导入供应商", "对账单")):
        result = _rule_supplier_ops(ctx, text)
        result.mode = "rule"
        result.intent = "supplier"
        return result
    intent = detect_intent(text)
    handler = _RULE_HANDLERS.get(intent, _rule_inventory)
    result = handler(ctx, text)
    result.mode = "rule"
    result.intent = intent
    return result


# --------------------------------------------------------------------------- #
# LLM 工具循环
# --------------------------------------------------------------------------- #
def run_llm(
    ctx: ToolContext,
    messages: list[dict[str, Any]],
    *,
    context_type: str | None = None,
    context_label: str | None = None,
) -> AgentResult:
    from openai import OpenAI

    client = OpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL or None,
        timeout=settings.LLM_TIMEOUT_SECONDS,
    )
    schemas = openai_tool_schemas(ctx.user)
    system = SYSTEM_PROMPT + context_hint(context_type, context_label)
    payload = [{"role": "system", "content": system}, *messages]

    for _round in range(settings.LLM_MAX_TOOL_ROUNDS):
        completion = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=payload,
            tools=schemas or None,
            tool_choice="auto" if schemas else None,
            temperature=settings.LLM_TEMPERATURE,
        )
        message = completion.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)

        if not tool_calls:
            answer = (message.content or "").strip()
            if not answer:
                raise ValueError("模型返回空内容")
            return AgentResult(
                answer=answer,
                mode="llm",
                intent=detect_intent(messages[-1]["content"]),
                tool_calls=ctx.tool_calls,
                confirmation=ctx.confirmation,
            )

        payload.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in tool_calls
                ],
            }
        )

        for call in tool_calls:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            result = call_tool(ctx, call.function.name, arguments)
            payload.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str)[:6000],
                }
            )

    raise RuntimeError("工具调用轮次超限")


# --------------------------------------------------------------------------- #
# 统一入口
# --------------------------------------------------------------------------- #
def run_agent(
    db: Session,
    user: User,
    *,
    user_text: str,
    history: list[dict[str, Any]] | None = None,
    context_type: str | None = None,
    context_label: str | None = None,
) -> AgentResult:
    ctx = ToolContext(db=db, user=user, tool_calls=[], confirmation=None)
    messages = [*(history or []), {"role": "user", "content": user_text}]

    if settings.llm_ready:
        try:
            return run_llm(
                ctx,
                messages,
                context_type=context_type,
                context_label=context_label,
            )
        except Exception as exc:  # noqa: BLE001 - 任何失败都降级，保证对话可用
            logger.warning("LLM 调用失败，降级为规则引擎：%s", exc)
            ctx = ToolContext(db=db, user=user, tool_calls=[], confirmation=None)

    return run_rule_engine(ctx, user_text)


__all__ = [
    "AgentResult",
    "SECTION_TITLES",
    "detect_intent",
    "render_answer",
    "run_agent",
    "run_llm",
    "run_rule_engine",
]
