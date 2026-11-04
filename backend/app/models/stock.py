"""库存结存、库存流水与库存调拨。"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, utcnow

if TYPE_CHECKING:  # pragma: no cover
    from app.models.master_data import Product, Warehouse


class WarehouseStock(Base):
    """warehouse_stock：商品在各仓库的现存数量。"""

    __tablename__ = "warehouse_stock"
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id", name="uk_warehouse_stock_product_warehouse"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(16), ForeignKey("products.id"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(16), ForeignKey("warehouses.id"), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    product: Mapped["Product"] = relationship("Product", lazy="joined")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse", lazy="joined")


class InventoryTransaction(Base):
    """inventory_transactions：库存流水（每次库存变动都留痕）。"""

    __tablename__ = "inventory_transactions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    product_id: Mapped[str] = mapped_column(String(16), ForeignKey("products.id"), nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(120))
    warehouse_id: Mapped[str] = mapped_column(String(16), ForeignKey("warehouses.id"), nullable=False)
    warehouse_name: Mapped[str | None] = mapped_column(String(80))
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    before_qty: Mapped[int | None] = mapped_column(Integer)
    after_qty: Mapped[int | None] = mapped_column(Integer)
    ref_code: Mapped[str | None] = mapped_column(String(32))
    operator: Mapped[str | None] = mapped_column(String(40), ForeignKey("users.username"))
    remark: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)

    product: Mapped["Product"] = relationship("Product", lazy="joined")
    warehouse: Mapped["Warehouse"] = relationship("Warehouse", lazy="joined")


class StockTransfer(Base):
    """stock_transfers：库存调拨单（一次只调拨一个商品）。"""

    __tablename__ = "stock_transfers"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    from_warehouse_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("warehouses.id"), nullable=False
    )
    from_warehouse_name: Mapped[str | None] = mapped_column(String(80))
    to_warehouse_id: Mapped[str] = mapped_column(String(16), ForeignKey("warehouses.id"), nullable=False)
    to_warehouse_name: Mapped[str | None] = mapped_column(String(80))
    product_id: Mapped[str] = mapped_column(String(16), ForeignKey("products.id"), nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(120))
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    operator: Mapped[str | None] = mapped_column(String(40), ForeignKey("users.username"))
    remark: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    product: Mapped["Product"] = relationship("Product", lazy="joined")
    from_warehouse: Mapped["Warehouse"] = relationship(
        "Warehouse", foreign_keys=[from_warehouse_id], lazy="joined"
    )
    to_warehouse: Mapped["Warehouse"] = relationship(
        "Warehouse", foreign_keys=[to_warehouse_id], lazy="joined"
    )
