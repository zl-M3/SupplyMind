"""AI 智能中心：会话、消息、任务、报告与「确认后写入」闭环。"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import BusinessRuleError, NotFoundError, PermissionDeniedError
from app.core.ids import gen_id
from app.core.utils import paginate, utcnow
from app.models.ai import AIFeedback, AIReportSchedule, AIConversation, AIMessage, AIReport, AITask
from app.models.enums import (
    ContextType,
    MessageRole,
    ReportType,
    TaskStatus,
    TaskType,
)
from app.models.user import User
from app.schemas.ai import (
    AnalysisResponse,
    ChatRequest,
    ChatResponse,
    ConfirmationCreate,
    ConversationBrief,
    ConversationOut,
    MessageOut,
    ReportBrief,
    ReportContent,
    ReportOut,
    TaskOut,
)
from app.schemas.purchase import PurchaseOrderCreate, PurchaseOrderItemIn
from app.services.ai import reports
from app.services.ai.runner import run_agent
from app.services.ai.tools import allowed_tools, tool_infos
from app.services.purchase_service import create_order

logger = logging.getLogger(__name__)

TASK_TYPE_LABELS: dict[str, str] = {
    TaskType.INVENTORY_ANALYSIS.value: "库存分析",
    TaskType.REPLENISHMENT.value: "补货建议",
    TaskType.PURCHASE_DRAFT.value: "采购草稿",
    TaskType.LOGISTICS_ANOMALY.value: "物流异常",
    TaskType.SUPPLIER_RISK.value: "供应商风险",
    TaskType.KNOWLEDGE_QA.value: "知识问答",
    TaskType.GENERAL_QA.value: "综合问答",
}

TASK_STATUS_LABELS: dict[str, str] = {
    TaskStatus.PENDING.value: "排队中",
    TaskStatus.RUNNING.value: "执行中",
    TaskStatus.WAITING_CONFIRM.value: "待确认",
    TaskStatus.DONE.value: "已完成",
    TaskStatus.FAILED.value: "失败",
}

REPORT_TYPE_LABELS: dict[str, str] = {
    ReportType.REPLENISHMENT.value: "库存与补货",
    ReportType.SUPPLIER_RISK.value: "供应商风险",
    ReportType.LOGISTICS_ANOMALY.value: "物流异常",
}

_INTENT_TASK_TYPE: dict[str, TaskType] = {
    "replenishment": TaskType.REPLENISHMENT,
    "inventory": TaskType.INVENTORY_ANALYSIS,
    "logistics": TaskType.LOGISTICS_ANOMALY,
    "supplier": TaskType.SUPPLIER_RISK,
    "purchase": TaskType.PURCHASE_DRAFT,
    "knowledge": TaskType.KNOWLEDGE_QA,
    "general": TaskType.GENERAL_QA,
}


def task_type_of(intent: str) -> str:
    return _INTENT_TASK_TYPE.get(intent, TaskType.GENERAL_QA).value


# --------------------------------------------------------------------------- #
# 序列化
# --------------------------------------------------------------------------- #
# 旧版本曾把 evidence / actions 以对象形式写进库（例如 {"P003": {"safety": 300}}），
# 新版 schema 要求列表；这里统一归一化，避免历史会话一打开就 500。
_EVIDENCE_KEY_LABELS: dict[str, str] = {
    "safety": "安全库存",
    "on_hand": "在库",
    "on_way": "在途",
    "in_transit": "在途",
    "late_times": "延迟次数",
    "avg_delay_days": "平均延迟天数",
}


def _kv_text(value: dict[str, Any]) -> str:
    parts = [
        f"{_EVIDENCE_KEY_LABELS.get(str(key), str(key))} {val}" for key, val in value.items()
    ]
    return "，".join(parts)


def normalize_evidence(value: Any) -> list[Any] | None:
    """把字符串 / 对象 / 列表形态的「数据依据」统一成列表。"""
    if value is None or value == "" or value == {} or value == []:
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        items = [
            {
                "label": str(key),
                "value": _kv_text(val)
                if isinstance(val, dict)
                else ("，".join(str(x) for x in val) if isinstance(val, (list, tuple)) else str(val)),
            }
            for key, val in value.items()
        ]
        return items or None
    return [value]


def normalize_actions(value: Any) -> list[Any] | None:
    """把字符串 / 对象 / 列表形态的「建议动作」统一成列表。"""
    if value is None or value == "":
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [f"{key}：{val}" for key, val in value.items()]
    return [value]


_THINK_RE = re.compile(r"<think\b[^>]*>.*?</think\s*>", re.S | re.I)
_THINK_OPEN_RE = re.compile(r"<think\b[^>]*>.*$", re.S | re.I)


def strip_thinking(text: str | None) -> str | None:
    """去掉模型输出里的 <think>…</think> 推理段，只留最终结果。"""
    if not text:
        return text
    cleaned = _THINK_RE.sub("", text)
    cleaned = _THINK_OPEN_RE.sub("", cleaned)
    return cleaned.strip()


def message_to_out(message: AIMessage) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        content=strip_thinking(message.content) or "",
        conclusion=strip_thinking(message.conclusion),
        evidence=normalize_evidence(message.evidence),
        cause=strip_thinking(message.cause),
        actions=normalize_actions(message.actions),
        draft_payload=message.draft_payload,
        tool_calls=message.tool_calls,
        citations=message.citations,
        task_id=message.task_id,
        report_id=message.report_id,
        created_at=message.created_at,
    )


def conversation_to_out(
    conversation: AIConversation, messages: list[AIMessage] | None = None
) -> ConversationOut:
    items = messages if messages is not None else list(conversation.messages)
    return ConversationOut(
        id=conversation.id,
        title=conversation.title,
        username=conversation.username,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        message_count=len(items),
        messages=[message_to_out(item) for item in items],
    )


def task_to_out(task: AITask) -> TaskOut:
    return TaskOut(
        id=task.id,
        name=task.name,
        type=task.type,
        type_label=TASK_TYPE_LABELS.get(task.type, task.type),
        status=task.status,
        status_label=TASK_STATUS_LABELS.get(task.status, task.status),
        created_by=task.created_by,
        summary=task.summary or "",
        payload=task.payload,
        tool_calls=task.tool_calls,
        result_text=task.result_text,
        error=task.error,
        created_at=task.created_at,
        report_id=(task.payload or {}).get("report_id") if task.payload else None,
    )


def report_to_out(report: AIReport) -> ReportOut:
    return ReportOut(
        id=report.id,
        type=report.type,
        type_label=REPORT_TYPE_LABELS.get(report.type, report.type),
        title=report.title,
        target_id=report.target_id,
        target_name=report.target_name,
        conclusion=report.conclusion,
        evidence=normalize_evidence(report.evidence),
        cause=report.cause,
        suggestions=normalize_actions(report.suggestions),
        created_by=report.created_by,
        creator_name=report.creator.display_name if report.creator else None,
        created_at=report.created_at,
    )


def report_brief(report: AIReport) -> ReportBrief:
    return ReportBrief(
        id=report.id,
        type=report.type,
        type_label=REPORT_TYPE_LABELS.get(report.type, report.type),
        title=report.title,
        target_name=report.target_name,
        created_by=report.created_by,
        created_at=report.created_at,
    )


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #
def get_conversation(db: Session, conversation_id: str, user: User) -> AIConversation:
    conversation = db.get(AIConversation, conversation_id)
    if conversation is None:
        raise NotFoundError("会话不存在")
    if conversation.username != user.username:
        raise PermissionDeniedError("无权访问该会话")
    return conversation


def create_conversation(
    db: Session,
    user: User,
    *,
    title: str | None,
    context_type: ContextType = ContextType.NONE,
    context_id: str | None = None,
    context_label: str | None = None,
) -> AIConversation:
    now = utcnow()
    conversation = AIConversation(
        id=gen_id("CV", 16),
        username=user.username,
        title=(title or "新对话")[:120],
        created_at=now,
        updated_at=now,
    )
    db.add(conversation)
    db.flush()
    return conversation


def list_conversations(
    db: Session, user: User, *, page: int = 1, page_size: int = 20
) -> tuple[list[ConversationBrief], int]:
    stmt = select(AIConversation).where(AIConversation.username == user.username)
    stmt = stmt.order_by(AIConversation.updated_at.desc())
    rows, total = paginate(db, stmt, page, page_size)

    briefs: list[ConversationBrief] = []
    for conversation in rows:
        count = db.scalar(
            select(func.count())
            .select_from(AIMessage)
            .where(AIMessage.conversation_id == conversation.id)
        )
        briefs.append(
            ConversationBrief(
                id=conversation.id,
                title=conversation.title,
                username=conversation.username,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                message_count=int(count or 0),
            )
        )
    return briefs, total


def update_conversation(db: Session, conversation: AIConversation, title: str) -> AIConversation:
    conversation.title = title[:120]
    conversation.updated_at = utcnow()
    db.flush()
    return conversation


def delete_conversation(db: Session, conversation: AIConversation) -> None:
    db.delete(conversation)
    db.flush()


def add_message(
    db: Session,
    conversation: AIConversation,
    *,
    role: MessageRole,
    content: str,
    conclusion: str | None = None,
    evidence: list[Any] | None = None,
    cause: str | None = None,
    actions: list[Any] | None = None,
    draft_payload: dict[str, Any] | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    citations: list[dict[str, Any]] | None = None,
    task_id: str | None = None,
    report_id: str | None = None,
) -> AIMessage:
    message = AIMessage(
        id=gen_id("MSG", 32),
        conversation_id=conversation.id,
        role=role.value,
        content=content,
        conclusion=conclusion,
        evidence=evidence,
        cause=cause,
        actions=actions,
        draft_payload=draft_payload,
        tool_calls=tool_calls,
        citations=citations,
        task_id=task_id,
        report_id=report_id,
        created_at=utcnow(),
    )
    db.add(message)
    conversation.updated_at = message.created_at
    db.flush()
    return message


def _history_for_llm(conversation: AIConversation, limit: int = 8) -> list[dict[str, str]]:
    messages = sorted(conversation.messages, key=lambda item: item.created_at)[-limit:]
    return [
        {"role": item.role, "content": item.content}
        for item in messages
        if item.role in (MessageRole.USER.value, MessageRole.ASSISTANT.value)
    ]


# --------------------------------------------------------------------------- #
# 任务与报告
# --------------------------------------------------------------------------- #
def create_task(
    db: Session,
    user: User,
    *,
    name: str,
    task_type: str,
    payload: dict[str, Any] | None = None,
) -> AITask:
    task = AITask(
        id=gen_id("TASK", 16),
        name=name[:120],
        type=task_type,
        status=TaskStatus.RUNNING.value,
        created_by=user.username,
        summary="",
        payload=payload,
        tool_calls=None,
        result_text=None,
        error=None,
        created_at=utcnow(),
    )
    db.add(task)
    db.flush()
    return task


def get_task(db: Session, task_id: str, user: User) -> AITask:
    task = db.get(AITask, task_id)
    if task is None:
        raise NotFoundError("任务不存在")
    if task.created_by != user.username:
        raise PermissionDeniedError("无权访问该任务")
    return task


def list_tasks(
    db: Session,
    *,
    user: User | None = None,
    task_type: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[TaskOut], int]:
    stmt = select(AITask)
    if user is not None:
        stmt = stmt.where(AITask.created_by == user.username)
    if task_type:
        stmt = stmt.where(AITask.type == task_type)
    if status:
        stmt = stmt.where(AITask.status == status)
    stmt = stmt.order_by(AITask.created_at.desc())

    rows, total = paginate(db, stmt, page, page_size)
    return [task_to_out(task) for task in rows], total


def save_report(
    db: Session,
    *,
    payload: dict[str, Any],
    user: User,
    task_id: str | None = None,
) -> AIReport:
    content: ReportContent = payload["content"]
    report = AIReport(
        id=gen_id("RPT", 16),
        type=payload["report_type"],
        title=payload["title"][:120],
        target_id=payload.get("target_id"),
        target_name=payload.get("target_name"),
        conclusion=content.conclusion,
        evidence=content.evidence,
        cause=content.cause,
        suggestions=content.suggestions,
        created_by=user.username,
        created_at=utcnow(),
    )
    db.add(report)
    db.flush()

    if task_id:
        task = db.get(AITask, task_id)
        if task is not None:
            data = dict(task.payload or {})
            data["report_id"] = report.id
            task.payload = data
    return report


def list_reports(
    db: Session,
    *,
    report_type: str | None = None,
    keyword: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ReportBrief], int]:
    stmt = select(AIReport)
    if report_type:
        stmt = stmt.where(AIReport.type == report_type)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(AIReport.title.like(like))
    stmt = stmt.order_by(AIReport.created_at.desc())

    rows, total = paginate(db, stmt, page, page_size)
    return [report_brief(item) for item in rows], total


def get_report(db: Session, report_id: str) -> AIReport:
    report = db.get(AIReport, report_id)
    if report is None:
        raise NotFoundError("报告不存在")
    return report


# --------------------------------------------------------------------------- #
# 对话
# --------------------------------------------------------------------------- #
def chat(db: Session, user: User, payload: ChatRequest) -> ChatResponse:
    if payload.conversation_id:
        conversation = get_conversation(db, payload.conversation_id, user)
    else:
        conversation = create_conversation(
            db,
            user,
            title=payload.content[:40],
            context_type=payload.context_type,
            context_id=payload.context_id,
            context_label=payload.context_label,
        )

    user_message = add_message(
        db, conversation, role=MessageRole.USER, content=payload.content
    )

    task = create_task(
        db,
        user,
        name=payload.content[:60],
        task_type=TaskType.GENERAL_QA.value,
        payload={
            "content": payload.content,
            "context_type": payload.context_type.value,
            "context_id": payload.context_id,
        },
    )

    try:
        history = _history_for_llm(conversation)[:-1]
        result = run_agent(
            db,
            user,
            user_text=payload.content,
            history=history,
            context_type=payload.context_type.value,
            context_label=payload.context_label,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("AI 对话失败")
        task.status = TaskStatus.FAILED.value
        task.error = str(exc)
        db.flush()
        assistant_message = add_message(
            db,
            conversation,
            role=MessageRole.ASSISTANT,
            content="抱歉，本次分析没有完成，请稍后重试。",
            task_id=task.id,
        )
        return ChatResponse(
            conversation_id=conversation.id,
            user_message=message_to_out(user_message),
            assistant_message=message_to_out(assistant_message),
            task=task_to_out(task),
            confirmation=None,
            mode="rule",
            tool_calls=[],
        )

    task.type = task_type_of(result.intent)
    task.tool_calls = [log.model_dump(mode="json") for log in result.tool_calls]
    answer = strip_thinking(result.answer) or result.answer
    task.result_text = answer
    if result.confirmation is not None:
        task.status = TaskStatus.WAITING_CONFIRM.value
        confirmation_payload = result.confirmation.model_dump(mode="json")
        task.payload = {**(task.payload or {}), "confirmation": confirmation_payload}
    else:
        task.status = TaskStatus.DONE.value
    db.flush()

    sections = _split_sections(answer)
    assistant_message = add_message(
        db,
        conversation,
        role=MessageRole.ASSISTANT,
        content=answer,
        conclusion=sections.get("结论"),
        evidence=sections.get("数据依据"),
        cause=sections.get("原因分析"),
        actions=sections.get("可执行操作"),
        draft_payload=(
            result.confirmation.model_dump(mode="json") if result.confirmation else None
        ),
        tool_calls=[log.model_dump(mode="json") for log in result.tool_calls],
        citations=result.citations or None,
        task_id=task.id,
    )

    return ChatResponse(
        conversation_id=conversation.id,
        user_message=message_to_out(user_message),
        assistant_message=message_to_out(assistant_message),
        task=task_to_out(task),
        confirmation=result.confirmation,
        mode=result.mode,
        tool_calls=result.tool_calls,
    )


def _split_sections(answer: str) -> dict[str, Any]:
    """把五段式 Markdown 拆成结构化字段，便于前端渲染与落库。"""
    result: dict[str, Any] = {}
    current: str | None = None
    buffer: list[str] = []
    titles = ("结论", "数据依据", "原因分析", "建议动作", "可执行操作")

    def flush() -> None:
        if current is None:
            return
        text = "\n".join(buffer).strip()
        if current in ("数据依据", "可执行操作", "建议动作"):
            items = [
                line[2:].strip()
                for line in text.splitlines()
                if line.strip().startswith("- ")
            ]
            result[current] = items or ([text] if text else [])
        else:
            result[current] = text

    for line in answer.splitlines():
        stripped = line.strip()
        if stripped.startswith("###"):
            title = stripped.lstrip("#").strip()
            if title in titles:
                flush()
                current = title
                buffer = []
                continue
        if current:
            buffer.append(line)
    flush()
    return result


def _order_from_confirmation(
    payload: ConfirmationCreate, confirmation: dict[str, Any], user: User
) -> PurchaseOrderCreate:
    supplier_id = confirmation.get("supplier_id")
    if not supplier_id:
        raise BusinessRuleError("草稿缺少供应商，无法生成采购订单", code="DRAFT_SUPPLIER_REQUIRED")
    items = [
        PurchaseOrderItemIn(product_id=item.product_id, qty=item.qty, price=item.price)
        for item in payload.items
    ]
    return PurchaseOrderCreate(
        supplier_id=supplier_id,
        expected_arrival=payload.expected_arrival or confirmation.get("expected_arrival"),
        remark=payload.remark or confirmation.get("reason"),
        items=items,
    )


def confirm_task(
    db: Session, task_id: str, payload: ConfirmationCreate, user: User
) -> dict[str, Any]:
    task = get_task(db, task_id, user)
    if task.status != TaskStatus.WAITING_CONFIRM.value:
        raise BusinessRuleError("该任务当前不需要确认", code="TASK_NOT_WAITING_CONFIRM")

    confirmation = (task.payload or {}).get("confirmation") or {}
    if not confirmation:
        raise BusinessRuleError("任务缺少确认内容，请重新生成草稿", code="TASK_CONFIRMATION_MISSING")

    order_payload = _order_from_confirmation(payload, confirmation, user)
    order = create_order(db, order_payload, user=user)

    task.status = TaskStatus.DONE.value
    task.result_text = f"已生成采购订单 {order.code}（草稿）"
    task.payload = {
        **(task.payload or {}),
        "order_id": order.id,
        "order_code": order.code,
    }
    db.flush()

    return {
        "message": f"采购订单 {order.code} 已创建（草稿态）",
        "order_id": order.id,
        "order_code": order.code,
        "task": task_to_out(task).model_dump(mode="json"),
    }


def cancel_task(db: Session, task_id: str, user: User) -> dict[str, Any]:
    task = get_task(db, task_id, user)
    if task.status in (TaskStatus.DONE.value, TaskStatus.FAILED.value):
        raise BusinessRuleError("任务已结束，无法取消", code="TASK_ALREADY_FINISHED")
    task.status = TaskStatus.FAILED.value
    task.error = "用户取消"
    db.flush()
    return {"message": "任务已取消", "task": task_to_out(task).model_dump(mode="json")}


# --------------------------------------------------------------------------- #
# 分析报告（3 个必跑通场景）
# --------------------------------------------------------------------------- #
def analyze_inventory(db: Session, user: User) -> AnalysisResponse:
    return _run_analysis(
        db,
        user,
        name="库存分析与补货建议",
        task_type=TaskType.REPLENISHMENT.value,
        payload=reports.inventory_report(db),
    )


def analyze_supplier(
    db: Session, user: User, supplier_id: str | None = None
) -> AnalysisResponse:
    return _run_analysis(
        db,
        user,
        name="供应商风险分析",
        task_type=TaskType.SUPPLIER_RISK.value,
        payload=reports.supplier_risk_report(db, supplier_id),
    )


def analyze_logistics(db: Session, user: User, logistics_id: str) -> AnalysisResponse:
    return _run_analysis(
        db,
        user,
        name="物流异常分析",
        task_type=TaskType.LOGISTICS_ANOMALY.value,
        payload=reports.logistics_report(db, logistics_id),
    )


def analyze_purchase(db: Session, user: User) -> AnalysisResponse:
    overview = reports.purchase_overview(db)
    content = ReportContent(
        conclusion=f"当前有 {overview['pending']} 张采购订单待审批，近 {overview['total']} 张订单已纳入跟踪。",
        evidence=overview["evidence"] or ["暂无采购订单"],
        cause="待审批单需由非创建人的 GM 审批后才能创建物流单并收货；审批完成后才会进入收货环节。",
        suggestions=["优先处理待审批单，避免影响补货计划", "到货前确认物流单已创建并填写预计到达时间"],
        actions=["采购订单 → 待审批筛选", "采购订单详情 → 审批 / 收货"],
    )
    return _run_analysis(
        db,
        user,
        name="采购辅助分析",
        task_type=TaskType.PURCHASE_DRAFT.value,
        payload={
            "report_type": ReportType.REPLENISHMENT.value,
            "title": "采购辅助分析",
            "content": content,
        },
    )


def _run_analysis(
    db: Session,
    user: User,
    *,
    name: str,
    task_type: str,
    payload: dict[str, Any],
) -> AnalysisResponse:
    task = create_task(
        db, user, name=name, task_type=task_type, payload={"name": name}
    )
    report = save_report(db, payload=payload, user=user, task_id=task.id)
    task.status = TaskStatus.DONE.value
    task.summary = payload["content"].conclusion[:200]
    task.result_text = payload["content"].conclusion
    db.flush()
    return AnalysisResponse(
        task=task_to_out(task),
        report=report_to_out(report),
        content=payload["content"],
    )


# --------------------------------------------------------------------------- #
# 能力清单
# --------------------------------------------------------------------------- #
def capabilities(user: User | None = None) -> dict[str, Any]:
    mode = "llm" if settings.llm_ready else "rule"
    names = set(allowed_tools(user)) if user is not None else set()
    tools = [item for item in tool_infos() if not names or item["name"] in names]
    return {
        "enabled": True,
        "mode": mode,
        "model": settings.OPENAI_MODEL if settings.llm_ready else None,
        "tools": tools,
        "analysis": [
            {
                "key": "replenishment",
                "name": "库存分析与补货建议",
                "description": "按安全库存口径测算缺口，给出补货量与建议采购金额。",
                "endpoint": f"{settings.API_V1_PREFIX}/ai/analyze/inventory",
                "report_type": ReportType.REPLENISHMENT.value,
            },
            {
                "key": "supplier_risk",
                "name": "供应商风险分析",
                "description": "按准时交付率识别高风险供应商，样本不足时明确提示数据不足。",
                "endpoint": f"{settings.API_V1_PREFIX}/ai/analyze/supplier",
                "report_type": ReportType.SUPPLIER_RISK.value,
            },
            {
                "key": "logistics_anomaly",
                "name": "物流异常分析",
                "description": "从物流详情出发分析延迟与异常节点，给出处理建议。",
                "endpoint": f"{settings.API_V1_PREFIX}/ai/analyze/logistics/{{logistics_id}}",
                "report_type": ReportType.LOGISTICS_ANOMALY.value,
            },
        ],
    }


def add_feedback(
    db: Session, user: User, message_id: str, score: int, comment: str | None = None
) -> None:
    message = db.get(AIMessage, message_id)
    if message is None:
        raise NotFoundError("消息不存在")
    conversation = db.get(AIConversation, message.conversation_id)
    if conversation is None or conversation.username != user.username:
        raise PermissionDeniedError("只能评价自己的会话消息")
    feedback = AIFeedback(
        id=gen_id("FB", 32),
        message_id=message_id,
        username=user.username,
        score=score,
        comment=comment,
        created_at=utcnow(),
    )
    db.add(feedback)
    db.flush()


def feedback_summary(db: Session) -> dict[str, Any]:
    total = int(db.scalar(select(func.count()).select_from(AIFeedback)) or 0)
    up = int(
        db.scalar(select(func.count()).select_from(AIFeedback).where(AIFeedback.score > 0)) or 0
    )
    down = int(
        db.scalar(select(func.count()).select_from(AIFeedback).where(AIFeedback.score < 0)) or 0
    )
    return {
        "total": total,
        "up": up,
        "down": down,
        "satisfaction": round(up / total, 4) if total else None,
    }


def get_report_schedule(db: Session, user: User) -> dict[str, Any]:
    row = db.get(AIReportSchedule, user.username)
    if row is None:
        return {"enabled": False, "daily_time": "08:30", "last_run": None}
    return {
        "enabled": bool(row.enabled),
        "daily_time": row.daily_time,
        "last_run": row.last_run.isoformat() if row.last_run else None,
    }


def update_report_schedule(
    db: Session, user: User, *, enabled: bool, daily_time: str | None
) -> dict[str, Any]:
    row = db.get(AIReportSchedule, user.username)
    if row is None:
        row = AIReportSchedule(username=user.username, enabled=0, daily_time="08:30")
    row.enabled = 1 if enabled else 0
    if daily_time:
        row.daily_time = daily_time
    row.updated_at = utcnow()
    db.add(row)
    db.flush()
    return get_report_schedule(db, user)


def optimize_replenishment(db: Session) -> dict[str, Any]:
    """比价选商：把缺口商品按「历史最低价 / 目录价」分配给候选供应商。"""
    from app.models import Product, PurchaseOrder, PurchaseOrderItem
    from app.services.inventory_service import inventory_alerts
    from app.services.master_data_service import supplier_options

    alerts, _total = inventory_alerts(db, page=1, page_size=50)
    suppliers = supplier_options(db)
    plan: list[dict[str, Any]] = []

    for alert in alerts:
        qty = int(getattr(alert, "shortage", 0) or 0)
        if qty <= 0:
            continue
        product = db.get(Product, alert.product_id)
        if product is None or not product.is_active:
            continue

        price_rows = db.execute(
            select(
                PurchaseOrder.supplier_id,
                PurchaseOrder.supplier_name,
                PurchaseOrderItem.price,
            )
            .join(PurchaseOrderItem, PurchaseOrderItem.po_id == PurchaseOrder.id)
            .where(
                PurchaseOrderItem.product_id == product.id,
                PurchaseOrder.status.not_in(("cancelled", "rejected")),
            )
            .order_by(PurchaseOrder.created_at.desc())
        ).all()
        seen: dict[str, dict[str, Any]] = {}
        for supplier_id, supplier_name, price in price_rows:
            if supplier_id in seen:
                continue
            seen[supplier_id] = {
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "price": float(price or 0),
                "source": "历史采购价",
            }

        candidates = list(seen.values())
        if not candidates:
            for option in suppliers:
                if product.category in (option.get("categories") or []):
                    candidates.append(
                        {
                            "supplier_id": option["id"],
                            "supplier_name": option["name"],
                            "price": float(product.purchase_price or 0),
                            "source": "商品目录价",
                        }
                    )
        if not candidates:
            continue

        best = min(candidates, key=lambda item: item["price"])
        base_price = float(product.purchase_price or best["price"])
        cost = round(best["price"] * qty, 2)
        baseline = round(base_price * qty, 2)
        plan.append(
            {
                "product_id": product.id,
                "product_name": product.name,
                "category": product.category,
                "qty": qty,
                "candidates": candidates,
                "best": best,
                "cost": cost,
                "baseline": baseline,
                "savings": round(baseline - cost, 2),
            }
        )

    total_cost = round(sum(item["cost"] for item in plan), 2)
    baseline_cost = round(sum(item["baseline"] for item in plan), 2)
    return {
        "plan": plan,
        "total_cost": total_cost,
        "baseline_cost": baseline_cost,
        "savings": round(baseline_cost - total_cost, 2),
        "note": "没有销售历史，不做需求预测；这里只按安全库存缺口 + 历史采购价 / 目录价做比价分配。",
    }


def run_due_report_schedules(db: Session) -> int:
    """到点就给订阅用户生成三份报告（由后台循环每分钟调用一次）。"""
    now = datetime.now()
    today = now.date()
    rows = db.scalars(
        select(AIReportSchedule).where(AIReportSchedule.enabled == 1)
    ).all()
    generated = 0
    for row in rows:
        if row.last_run == today:
            continue
        try:
            hour, minute = (int(part) for part in row.daily_time.split(":"))
        except (ValueError, AttributeError):
            hour, minute = 8, 30
        if (now.hour, now.minute) < (hour, minute):
            continue

        user = db.scalar(select(User).where(User.username == row.username))
        if user is None:
            continue
        for analyzer in (analyze_inventory, analyze_purchase, analyze_supplier):
            try:
                analyzer(db, user)
                db.commit()
                generated += 1
            except Exception:  # noqa: BLE001 - 单个报告失败不影响其它
                db.rollback()
                logger.exception("定时报告生成失败：%s", row.username)
        row = db.get(AIReportSchedule, row.username)
        if row is not None:
            row.last_run = today
            db.commit()
    return generated


__all__ = [
    "add_feedback",
    "feedback_summary",
    "get_report_schedule",
    "optimize_replenishment",
    "update_report_schedule",
    "REPORT_TYPE_LABELS",
    "TASK_STATUS_LABELS",
    "TASK_TYPE_LABELS",
    "add_message",
    "analyze_inventory",
    "analyze_logistics",
    "analyze_purchase",
    "analyze_supplier",
    "cancel_task",
    "capabilities",
    "chat",
    "confirm_task",
    "conversation_to_out",
    "create_conversation",
    "create_task",
    "delete_conversation",
    "get_conversation",
    "get_report",
    "get_task",
    "list_conversations",
    "list_reports",
    "list_tasks",
    "message_to_out",
    "report_brief",
    "report_to_out",
    "save_report",
    "task_to_out",
    "task_type_of",
    "update_conversation",
]
