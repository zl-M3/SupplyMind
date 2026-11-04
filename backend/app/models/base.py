"""模型公共基类与列类型约定。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

__all__ = ["Base", "utcnow", "CreatedAtMixin", "UpdatedAtMixin"]


def utcnow() -> datetime:
    """统一使用 naive UTC 时间入库（MySQL DATETIME 不带时区）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, index=True
    )


class UpdatedAtMixin:
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )
