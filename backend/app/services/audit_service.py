"""操作日志：``operation_logs``（module / action / target_type / target_id）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import OperationLog, User


def log_action(
    db: Session,
    *,
    user: User | str | None,
    module: str,
    action: str,
    target_type: str,
    target_id: str,
    detail: dict[str, Any] | None = None,
) -> OperationLog:
    """记录一条操作日志（只 flush，跟随业务事务一起提交）。"""
    username = user if isinstance(user, str) else getattr(user, "username", None)
    log = OperationLog(
        username=username or "system",
        module=module,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        detail=detail or {},
    )
    db.add(log)
    db.flush()
    return log
