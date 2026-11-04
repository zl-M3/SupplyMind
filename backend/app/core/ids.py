"""主键与业务单号生成。

``schema-mysql.sql`` 里多数表用 VARCHAR 主键（如 ``purchase_orders.id VARCHAR(32)``），
所以业务侧统一用带前缀的短 ID，既便于排查日志，也保证长度不超列宽。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def gen_id(prefix: str = "", total: int = 16) -> str:
    """生成 ``前缀 + 随机串`` 的字符串主键，总长度固定为 ``total``。

    >>> len(gen_id("PO", 32))
    32
    """
    prefix = prefix.upper()
    body_len = max(total - len(prefix), 8)
    return f"{prefix}{uuid.uuid4().hex[:body_len].upper()}"[:total]


def next_code(
    db: Session,
    model: type,
    column: str,
    prefix: str,
    *,
    when: datetime | None = None,
) -> str:
    """生成形如 ``PO20261101-0001`` 的业务单号（按天流水）。"""
    when = when or datetime.now()
    pattern = f"{prefix}{when:%Y%m%d}-"
    column_attr = getattr(model, column)
    stmt = select(func.max(column_attr)).where(column_attr.like(f"{pattern}%"))
    # 并发下两个事务会读到同一个 max，生成同一个单号 → 唯一键冲突（HTTP 409）。
    # 在 MySQL 上给这条读加行/间隙锁，让单号生成串行化。
    try:
        if db.get_bind().dialect.name != "sqlite":
            stmt = stmt.with_for_update()
    except Exception:  # noqa: BLE001 - 拿不到 bind 时退回普通读
        pass
    last = db.execute(stmt).scalar()

    # 种子数据会先在内存里批量构造对象、最后统一 flush，此时数据库里查不到同批对象。
    # 必须把 session 中待写入的对象一起比较，否则同一批会生成完全相同的单号
    # （曾导致 logistics_orders.code 唯一键冲突，演示数据整批回滚）。
    pending = [
        getattr(obj, column, None)
        for obj in db.new
        if isinstance(obj, model) and getattr(obj, column, None)
    ]
    if pending:
        pending_max = max(pending)
        if last is None or str(pending_max) > str(last):
            last = pending_max

    seq = 1
    if last:
        tail = str(last).split("-")[-1]
        seq = int(tail) + 1 if tail.isdigit() else 1
    return f"{pattern}{seq:04d}"
