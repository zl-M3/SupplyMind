"""系统设置服务：业务规则参数（system_configs）与操作日志查询。"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationFailure
from app.models import OperationLog, SystemConfig, User
from app.models.enums import ConfigValueType, UserRole
from app.schemas.system import SystemConfigCreate, SystemConfigOut, SystemConfigUpdate
from app.schemas.user import OperationLogOut

# 首期默认参数（与规划文档中的口径一一对应）
DEFAULT_CONFIGS: tuple[tuple[str, str, str, str], ...] = (
    ("purchase.approval_required", "采购订单是否需要审批", "1", "bool"),
    ("purchase.self_approval_forbidden", "创建人禁止自审批", "1", "bool"),
    ("inventory.alert_enabled", "库存预警是否启用", "1", "bool"),
    ("inventory.safety_stock_ratio", "安全库存默认系数", "1.0", "number"),
    ("logistics.delay_tolerance_days", "物流延迟判定容差（天）", "0", "number"),
    ("ai.report_min_sample", "准时交付率最小样本量", "3", "number"),
)


def config_to_out(config: SystemConfig) -> SystemConfigOut:
    return SystemConfigOut.model_validate(config)


def list_configs(db: Session) -> list[SystemConfigOut]:
    rows = db.scalars(select(SystemConfig).order_by(SystemConfig.id)).all()
    return [config_to_out(item) for item in rows]


def get_config(db: Session, config_id: str) -> SystemConfig:
    config = db.get(SystemConfig, config_id)
    if config is None:
        raise NotFoundError("参数不存在")
    return config


def _validate_value(value_type: str, value: str) -> None:
    text = (value or "").strip()
    if value_type == ConfigValueType.BOOL.value and text not in ("0", "1", "true", "false"):
        raise ValidationFailure("布尔类型参数只能是 0/1 或 true/false")
    if value_type == ConfigValueType.INT.value:
        try:
            int(text)
        except ValueError as exc:
            raise ValidationFailure("整数类型参数格式不正确") from exc
    if value_type == ConfigValueType.NUMBER.value:
        try:
            float(text)
        except ValueError as exc:
            raise ValidationFailure("数字类型参数格式不正确") from exc


def update_config(
    db: Session, config_id: str, payload: SystemConfigUpdate, *, user: User
) -> SystemConfig:
    config = get_config(db, config_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("label"):
        config.label = data["label"]
    if data.get("value_type") is not None:
        config.value_type = getattr(data["value_type"], "value", data["value_type"])
    if data.get("config_value") is not None:
        _validate_value(config.value_type, data["config_value"])
        config.config_value = data["config_value"]
    config.updated_by = user.username
    config.updated_at = datetime.now()
    db.flush()
    return config


def create_config(db: Session, payload: SystemConfigCreate, *, user: User) -> SystemConfig:
    config = SystemConfig(
        id=payload.id,
        label=payload.label,
        config_value=payload.config_value,
        value_type=payload.value_type.value,
        updated_by=user.username,
        updated_at=datetime.now(),
    )
    _validate_value(config.value_type, config.config_value)
    db.add(config)
    db.flush()
    return config


def ensure_default_configs(db: Session, updated_by: str | None = None) -> int:
    """补齐内置参数；``updated_by`` 缺省取第一个 GM 账号（表上外键要求是真实用户）。"""
    existing = {
        row for row in db.scalars(select(SystemConfig.id)).all()
    }
    if updated_by is None:
        updated_by = db.scalar(
            select(User.username)
            .where(User.role == UserRole.GM.value)
            .order_by(User.username)
            .limit(1)
        )
    if updated_by is None:
        return 0
    created = 0
    for config_id, label, value, value_type in DEFAULT_CONFIGS:
        if config_id in existing:
            continue
        db.add(
            SystemConfig(
                id=config_id,
                label=label,
                config_value=value,
                value_type=value_type,
                updated_by=updated_by,
                updated_at=datetime.now(),
            )
        )
        created += 1
    if created:
        db.flush()
    return created


def list_operation_logs(
    db: Session,
    *,
    username: str | None = None,
    module: str | None = None,
    action: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[OperationLogOut], int]:
    stmt = select(OperationLog)
    if username:
        stmt = stmt.where(OperationLog.username == username)
    if module:
        stmt = stmt.where(OperationLog.module == module)
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if start_date:
        stmt = stmt.where(
            OperationLog.created_at >= datetime.combine(start_date, datetime.min.time())
        )
    if end_date:
        stmt = stmt.where(
            OperationLog.created_at <= datetime.combine(end_date, datetime.max.time())
        )

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [OperationLogOut.model_validate(item) for item in rows], total
