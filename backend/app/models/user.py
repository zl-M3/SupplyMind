"""用户账号：``users``（主键是登录账号 username）。"""

from __future__ import annotations

from sqlalchemy import SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(40), primary_key=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=UserRole.SALES.value)
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    # ------------------------------------------------------------------ #
    @property
    def is_active(self) -> bool:
        return int(self.status) == 1

    @property
    def role_enum(self) -> UserRole:
        try:
            return UserRole(self.role)
        except ValueError:  # pragma: no cover - 数据异常兜底
            return UserRole.SALES

    @property
    def role_label(self) -> str:
        return self.role_enum.label

    @property
    def status_label(self) -> str:
        return "启用" if self.is_active else "停用"

    def has_role(self, *roles: str | UserRole) -> bool:
        wanted = {str(item.value if isinstance(item, UserRole) else item) for item in roles}
        return self.role in wanted

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<User {self.username} {self.role}>"
