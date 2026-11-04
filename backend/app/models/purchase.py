"""采购订单、明细、收货单与收货明细。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, utcnow
from app.models.enums import PurchaseOrderStatus

if TYPE_CHECKING:  # pragma: no cover
    from app.models.master_data import Supplier
    from app.models.user import User


class PurchaseOrder(Base):
    """purchase_orders：采购订单头。"""

    __tablename__ = "purchase_orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    supplier_id: Mapped[str] = mapped_column(String(16), ForeignKey("suppliers.id"), nullable=False)
    supplier_name: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=PurchaseOrderStatus.DRAFT.value, index=True
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, index=True)
    expected_arrival: Mapped[date] = mapped_column(Date, nullable=False)
    approver: Mapped[str | None] = mapped_column(String(40), ForeignKey("users.username"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    reject_reason: Mapped[str | None] = mapped_column(String(500))
    remark: Mapped[str | None] = mapped_column(String(500))
    logistics_id: Mapped[str | None] = mapped_column(String(32))

    supplier: Mapped["Supplier"] = relationship("Supplier", lazy="joined")
    items: Mapped[list["PurchaseOrderItem"]] = relationship(
        "PurchaseOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PurchaseOrderItem.id",
    )
    receipts: Mapped[list["PurchaseReceipt"]] = relationship(
        "PurchaseReceipt",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PurchaseReceipt.received_at",
    )
    creator: Mapped["User"] = relationship(
        "User", foreign_keys=[created_by], lazy="joined"
    )
    approver_user: Mapped["User | None"] = relationship(
        "User", foreign_keys=[approver], lazy="joined"
    )

    # ------------------------------------------------------------------ #
    @property
    def status_enum(self) -> PurchaseOrderStatus:
        try:
            return PurchaseOrderStatus(self.status)
        except ValueError:  # pragma: no cover - 数据异常兜底
            return PurchaseOrderStatus.DRAFT

    @property
    def status_label(self) -> str:
        return self.status_enum.label

    @property
    def ordered_qty(self) -> int:
        return sum(int(item.qty or 0) for item in self.items)

    @property
    def received_qty(self) -> int:
        return sum(int(item.received_qty or 0) for item in self.items)

    @property
    def remaining_qty(self) -> int:
        return sum(int(item.remaining_qty) for item in self.items)


class PurchaseOrderItem(Base):
    """purchase_order_items：采购订单明细。"""

    __tablename__ = "purchase_order_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    po_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[str] = mapped_column(String(16), ForeignKey("products.id"), nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(120))
    spec: Mapped[str | None] = mapped_column(String(80))
    unit: Mapped[str | None] = mapped_column(String(16))
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    received_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)

    order: Mapped[PurchaseOrder] = relationship("PurchaseOrder", back_populates="items")

    @property
    def remaining_qty(self) -> int:
        return max(int(self.qty or 0) - int(self.received_qty or 0), 0)


class PurchaseReceipt(Base):
    """purchase_receipts：采购收货单（一次收货可能覆盖多行明细）。"""

    __tablename__ = "purchase_receipts"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    po_id: Mapped[str] = mapped_column(String(32), ForeignKey("purchase_orders.id"), nullable=False)
    warehouse_id: Mapped[str] = mapped_column(String(16), ForeignKey("warehouses.id"), nullable=False)
    received_by: Mapped[str] = mapped_column(String(40), ForeignKey("users.username"), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    remark: Mapped[str | None] = mapped_column(String(300))

    order: Mapped[PurchaseOrder] = relationship("PurchaseOrder", back_populates="receipts")
    items: Mapped[list["PurchaseReceiptItem"]] = relationship(
        "PurchaseReceiptItem",
        back_populates="receipt",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PurchaseReceiptItem.id",
    )
    receiver: Mapped["User"] = relationship("User", foreign_keys=[received_by], lazy="joined")


class PurchaseReceiptItem(Base):
    """purchase_receipt_items：收货单明细。"""

    __tablename__ = "purchase_receipt_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    receipt_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("purchase_receipts.id", ondelete="CASCADE"), nullable=False
    )
    po_item_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("purchase_order_items.id"), nullable=False
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    receipt: Mapped[PurchaseReceipt] = relationship("PurchaseReceipt", back_populates="items")
    order_item: Mapped[PurchaseOrderItem] = relationship("PurchaseOrderItem", lazy="joined")
