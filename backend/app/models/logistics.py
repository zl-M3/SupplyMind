"""物流单与物流轨迹节点。"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, utcnow
from app.models.enums import LogisticsStatus

if TYPE_CHECKING:  # pragma: no cover
    from app.models.master_data import Supplier
    from app.models.purchase import PurchaseOrder


class LogisticsOrder(Base):
    """logistics_orders：物流单（一个采购单对应一张物流单）。"""

    __tablename__ = "logistics_orders"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    po_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("purchase_orders.id"), nullable=False, unique=True
    )
    po_code: Mapped[str | None] = mapped_column(String(32))
    supplier_id: Mapped[str] = mapped_column(String(16), ForeignKey("suppliers.id"), nullable=False)
    supplier_name: Mapped[str | None] = mapped_column(String(120))
    carrier: Mapped[str | None] = mapped_column(String(40))
    tracking_no: Mapped[str | None] = mapped_column(String(64), unique=True)
    expected_arrival: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=LogisticsStatus.PENDING.value, index=True
    )
    is_delayed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    remark: Mapped[str | None] = mapped_column(String(300))

    supplier: Mapped["Supplier"] = relationship("Supplier", lazy="joined")
    order: Mapped["PurchaseOrder"] = relationship("PurchaseOrder", lazy="joined")
    events: Mapped[list["LogisticsEvent"]] = relationship(
        "LogisticsEvent",
        back_populates="logistics",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="LogisticsEvent.time",
    )

    @property
    def status_enum(self) -> LogisticsStatus:
        try:
            return LogisticsStatus(self.status)
        except ValueError:  # pragma: no cover
            return LogisticsStatus.PENDING

    @property
    def status_label(self) -> str:
        return self.status_enum.label


class LogisticsEvent(Base):
    """logistics_events：物流轨迹节点。"""

    __tablename__ = "logistics_events"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    logistics_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("logistics_orders.id", ondelete="CASCADE"), nullable=False
    )
    time: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    node: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    location: Mapped[str | None] = mapped_column(String(80))

    logistics: Mapped[LogisticsOrder] = relationship("LogisticsOrder", back_populates="events")
