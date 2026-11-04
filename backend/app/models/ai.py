"""AI 会话、消息、Agent 任务与分析报告。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.mysql import DATETIME as MySQLDateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, utcnow
from app.models.enums import MessageRole, TaskStatus

# 消息时间要精确到微秒：MySQL 默认 DATETIME 只到秒，
# 同一秒内写入的「用户提问 + AI 回答」会变成同一时刻，历史消息顺序会乱。
MessageTimestamp = DateTime().with_variant(MySQLDateTime(fsp=6), "mysql")


class AIConversation(Base):
    """ai_conversations：一个用户的多轮会话。"""

    __tablename__ = "ai_conversations"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    username: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    title: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )
    dify_conversation_id: Mapped[str | None] = mapped_column(String(64), unique=True)

    messages: Mapped[list["AIMessage"]] = relationship(
        "AIMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="AIMessage.created_at",
    )


class AITask(Base):
    """ai_tasks：Agent 任务（含草稿待确认状态）。"""

    __tablename__ = "ai_tasks"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=TaskStatus.PENDING.value)
    created_by: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    result_text: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    dify_run_id: Mapped[str | None] = mapped_column(String(64))

    @property
    def status_enum(self) -> TaskStatus:
        try:
            return TaskStatus(self.status)
        except ValueError:  # pragma: no cover
            return TaskStatus.PENDING

    @property
    def status_label(self) -> str:
        return self.status_enum.label


class AIReport(Base):
    """ai_reports：AI 分析报告（五段式中的结论/依据/原因/建议）。"""

    __tablename__ = "ai_reports"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    type: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(32))
    target_name: Mapped[str | None] = mapped_column(String(120))
    conclusion: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    cause: Mapped[str] = mapped_column(Text, nullable=False)
    suggestions: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    created_by: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    creator: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by], lazy="joined"
    )


class AIMessage(Base):
    """ai_messages：会话消息（assistant 消息带五段式结构化字段）。"""

    __tablename__ = "ai_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(12), nullable=False, default=MessageRole.USER.value)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    conclusion: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[list[Any] | None] = mapped_column(JSON)
    cause: Mapped[str | None] = mapped_column(Text)
    actions: Mapped[list[Any] | None] = mapped_column(JSON)
    draft_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    task_id: Mapped[str | None] = mapped_column(String(16), ForeignKey("ai_tasks.id"))
    report_id: Mapped[str | None] = mapped_column(String(16), ForeignKey("ai_reports.id"))
    created_at: Mapped[datetime] = mapped_column(
        MessageTimestamp, nullable=False, default=utcnow
    )

    conversation: Mapped[AIConversation] = relationship(
        "AIConversation", back_populates="messages"
    )


class AIFeedback(Base):
    """ai_feedback：用户对 AI 回答的点赞 / 点踩，用于评估质量。"""

    __tablename__ = "ai_feedback"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    message_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        MessageTimestamp, nullable=False, default=utcnow
    )


class AIReportSchedule(Base):
    """ai_report_schedules：AI 报告定时生成（每人一条）。"""

    __tablename__ = "ai_report_schedules"

    username: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    daily_time: Mapped[str] = mapped_column(String(5), nullable=False, default="08:30")
    last_run: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(
        MessageTimestamp, nullable=False, default=utcnow, onupdate=utcnow
    )
