"""AI 智能中心出入参：会话、消息、任务、报告、工具链路。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import ContextType
from app.schemas.common import ORMModel


# --------------------------------------------------------------------------- #
# 会话与消息
# --------------------------------------------------------------------------- #
class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    context_type: ContextType = ContextType.NONE
    context_id: str | None = None
    context_label: str | None = Field(default=None, max_length=120)


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class MessageOut(ORMModel):
    id: str
    conversation_id: str
    role: str
    content: str
    conclusion: str | None = None
    evidence: list[Any] | None = None
    cause: str | None = None
    actions: list[Any] | None = None
    draft_payload: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] | None = None
    citations: list[Any] | None = None
    task_id: str | None = None
    report_id: str | None = None
    created_at: datetime


class ConversationBrief(ORMModel):
    id: str
    title: str | None = None
    username: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationOut(ConversationBrief):
    messages: list[MessageOut] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 工具调用
# --------------------------------------------------------------------------- #
class ToolCallLog(BaseModel):
    name: str
    label: str = ""
    arguments: dict[str, Any] = Field(default_factory=dict)
    status: str = "success"
    duration_ms: int = 0
    summary: str = ""
    error: str | None = None


class ToolInfo(BaseModel):
    name: str
    display_name: str
    description: str
    requires_confirmation: bool = False
    parameters: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 采购草稿确认卡片
# --------------------------------------------------------------------------- #
class DraftItem(BaseModel):
    product_id: str
    product_name: str | None = None
    spec: str | None = None
    unit: str | None = None
    qty: int
    price: Decimal | None = None
    amount: Decimal | None = None


class ConfirmationData(BaseModel):
    action: str = "create_purchase_draft"
    title: str = "采购草稿确认"
    supplier_id: str | None = None
    supplier_name: str | None = None
    items: list[DraftItem] = Field(default_factory=list)
    total_amount: Decimal = Decimal("0")
    expected_arrival: date | None = None
    reason: str = ""
    basis: list[str] = Field(default_factory=list)
    editable_fields: list[str] = Field(default_factory=lambda: ["items", "expected_arrival", "remark"])


class ConfirmationCreate(BaseModel):
    """用户确认草稿时提交的最终内容（可改数量与到货日期）。"""

    items: list[DraftItem] = Field(min_length=1)
    expected_arrival: date | None = None
    remark: str | None = Field(default=None, max_length=500)


# --------------------------------------------------------------------------- #
# 任务与报告
# --------------------------------------------------------------------------- #
class TaskOut(ORMModel):
    id: str
    name: str
    type: str
    type_label: str = ""
    status: str
    status_label: str = ""
    created_by: str
    summary: str
    payload: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] | None = None
    result_text: str | None = None
    error: str | None = None
    created_at: datetime
    report_id: str | None = None


class ReportContent(BaseModel):
    """五段式报告正文。"""

    conclusion: str
    evidence: list[str] = Field(default_factory=list)
    cause: str = ""
    suggestions: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)


class ReportOut(ORMModel):
    id: str
    type: str
    type_label: str = ""
    title: str
    target_id: str | None = None
    target_name: str | None = None
    conclusion: str
    evidence: list[Any] | None = None
    cause: str
    suggestions: list[Any] | None = None
    created_by: str
    creator_name: str | None = None
    created_at: datetime


class ReportBrief(ORMModel):
    id: str
    type: str
    type_label: str = ""
    title: str
    target_name: str | None = None
    created_by: str
    created_at: datetime


# --------------------------------------------------------------------------- #
# 对话请求与响应
# --------------------------------------------------------------------------- #
class ChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = None
    context_type: ContextType = ContextType.NONE
    context_id: str | None = None
    context_label: str | None = Field(default=None, max_length=120)


class ChatResponse(BaseModel):
    conversation_id: str
    user_message: MessageOut
    assistant_message: MessageOut
    task: TaskOut
    confirmation: ConfirmationData | None = None
    mode: str = "rule"
    tool_calls: list[ToolCallLog] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    task: TaskOut
    report: ReportOut
    content: ReportContent


class AnalysisCapability(BaseModel):
    key: str
    name: str
    description: str
    endpoint: str
    report_type: str


class KnowledgeHit(BaseModel):
    title: str
    section: str = ""
    content: str
    score: float = 0.0


class KnowledgeUpload(BaseModel):
    filename: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1)


class FeedbackIn(BaseModel):
    score: int = Field(ge=-1, le=1, description="1 点赞 / -1 点踩")
    comment: str | None = Field(default=None, max_length=500)
