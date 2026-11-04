"""账号与登录相关的出入参。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import UserRole
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40, description="登录账号")
    password: str = Field(min_length=1, max_length=72, description="登录密码")


class UserOut(ORMModel):
    username: str
    display_name: str
    role: str
    role_label: str = ""
    status: int
    status_label: str = ""


class UserBrief(BaseModel):
    username: str
    display_name: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=72)
    display_name: str = Field(min_length=1, max_length=50)
    role: UserRole = UserRole.SALES
    status: int = Field(default=1, ge=0, le=1)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=50)
    role: UserRole | None = None
    status: int | None = Field(default=None, ge=0, le=1)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=72)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=72)


class RoleOption(BaseModel):
    value: str
    label: str


class OperationLogOut(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    module: str
    action: str
    target_type: str
    target_id: str
    detail: dict | None = None
    created_at: datetime
