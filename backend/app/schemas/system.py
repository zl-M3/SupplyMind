"""系统设置：业务规则参数（system_configs）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import ConfigValueType
from app.schemas.common import ORMModel


class SystemConfigOut(ORMModel):
    id: str
    label: str
    config_value: str
    value_type: str
    value_type_label: str = ""
    updated_by: str
    updated_at: datetime


class SystemConfigCreate(BaseModel):
    id: str = Field(min_length=1, max_length=32, pattern=r"^[a-z][a-z0-9_.]*$")
    label: str = Field(min_length=1, max_length=80)
    config_value: str = Field(min_length=1, max_length=200)
    value_type: ConfigValueType = ConfigValueType.STRING


class SystemConfigUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    config_value: str | None = Field(default=None, max_length=200)
    value_type: ConfigValueType | None = None
