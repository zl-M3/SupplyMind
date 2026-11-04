"""通用工具函数。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def utcnow() -> datetime:
    """返回 *naive* UTC 时间，统一入库口径（避免 SQLite 丢失时区）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_decimal(value: Any, places: str = "0.01") -> Decimal:
    """安全转 Decimal 并保留指定精度。"""
    if isinstance(value, Decimal):
        return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(Decimal(places), rounding=ROUND_HALF_UP)


def generate_serial_no(db: Session, column, prefix: str) -> str:
    """生成按天递增的业务单号，例如 ``PO20261101-0003``。

    :param column: 需要生成单号的列（如 ``PurchaseOrder.order_no``）
    :param prefix: 业务前缀，如 ``PO`` / ``LG`` / ``TR``
    """
    today = datetime.now().strftime("%Y%m%d")
    head = f"{prefix}{today}-"
    last = db.scalar(select(column).where(column.like(f"{head}%")).order_by(column.desc()).limit(1))
    seq = 1
    if last:
        tail = str(last).rsplit("-", 1)[-1]
        if tail.isdigit():
            seq = int(tail) + 1
    return f"{head}{seq:04d}"


def paginate(db: Session, stmt, page: int, page_size: int) -> tuple[list[Any], int]:
    """对 ``select()`` 语句做分页，返回 (rows, total)。

    单列/单实体查询返回 ORM 对象列表；多列查询返回 ``Row`` 元组列表，
    调用方可直接 ``for a, b in rows`` 解包。
    """
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)
    paged = stmt.offset((page - 1) * page_size).limit(page_size)
    if len(stmt.column_descriptions) == 1:
        rows = list(db.scalars(paged).all())
    else:
        rows = list(db.execute(paged).all())
    return rows, total


def calc_pages(total: int, page_size: int) -> int:
    if page_size <= 0:
        return 0
    return (total + page_size - 1) // page_size


def as_date(value: datetime | date | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def days_between(start: date | None, end: date | None) -> int | None:
    if start is None or end is None:
        return None
    return (end - start).days


def truncate(text: str | None, limit: int = 200) -> str:
    """截断字符串，用于参数摘要记录。"""
    if not text:
        return ""
    return text if len(text) <= limit else text[: limit - 3] + "..."
