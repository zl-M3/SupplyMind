"""业务规则参数：把可调阈值放到数据库里，避免改代码重启。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow
from app.models.enums import ConfigValueType


class SystemConfig(Base):
    """system_configs：业务规则参数。"""

    __tablename__ = "system_configs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    config_value: Mapped[str] = mapped_column(String(200), nullable=False)
    value_type: Mapped[str] = mapped_column(String(16), nullable=False, default=ConfigValueType.STRING.value)
    updated_by: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    # ------------------------------------------------------------------ #
    @property
    def value_type_label(self) -> str:
        try:
            return ConfigValueType(self.value_type).label
        except ValueError:  # pragma: no cover
            return ConfigValueType.STRING.label

    @property
    def typed_value(self) -> Any:
        """按 value_type 把文本转成 Python 值。"""
        raw = self.config_value
        if self.value_type == ConfigValueType.INT.value:
            return int(raw)
        if self.value_type == ConfigValueType.BOOL.value:
            return raw.strip().lower() in {"1", "true", "yes", "on"}
        if self.value_type == ConfigValueType.DECIMAL.value:
            return Decimal(raw)
        return raw
