"""主数据：供应商 / 商品 / 仓库。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, DateTime, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow
from app.models.enums import MasterStatus


class Supplier(Base):
    """suppliers：供应商。"""

    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    contact: Mapped[str | None] = mapped_column(String(40))
    phone: Mapped[str | None] = mapped_column(String(32))
    categories: Mapped[list[Any] | None] = mapped_column(JSON, default=list)
    address: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MasterStatus.ACTIVE.value)
    remark: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    @property
    def status_label(self) -> str:
        return MasterStatus(self.status).label if self.status else MasterStatus.ACTIVE.label

    @property
    def is_active(self) -> bool:
        return self.status == MasterStatus.ACTIVE.value


class Product(Base):
    """products：商品。"""

    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # category 作为商品大类，与供应商的供货大类对应；sub_category 是商品小类
    category: Mapped[str | None] = mapped_column(String(40))
    sub_category: Mapped[str | None] = mapped_column(String(40))
    spec: Mapped[str | None] = mapped_column(String(80))
    unit: Mapped[str | None] = mapped_column(String(16))
    safety_stock: Mapped[int] = mapped_column(nullable=False, default=0)
    purchase_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MasterStatus.ACTIVE.value)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    @property
    def status_label(self) -> str:
        return MasterStatus(self.status).label if self.status else MasterStatus.ACTIVE.label

    @property
    def is_active(self) -> bool:
        return self.status == MasterStatus.ACTIVE.value


class Warehouse(Base):
    """warehouses：仓库。"""

    __tablename__ = "warehouses"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    address: Mapped[str | None] = mapped_column(String(200))
    manager: Mapped[str | None] = mapped_column(String(40))
    phone: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MasterStatus.ACTIVE.value)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    @property
    def status_label(self) -> str:
        return MasterStatus(self.status).label if self.status else MasterStatus.ACTIVE.label

    @property
    def is_active(self) -> bool:
        return self.status == MasterStatus.ACTIVE.value
