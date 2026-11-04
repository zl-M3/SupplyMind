"""数据库连接与 Session 管理（同步 SQLAlchemy 2.0 + MySQL）。"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def _engine_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {"echo": settings.DB_ECHO, "future": True, "pool_pre_ping": True}
    if settings.is_sqlite:
        # SQLite 仅作为可选回退：单进程开发/演示，需要在多线程中共享连接
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        return kwargs

    # MySQL / PostgreSQL：使用连接池，并定期回收空闲连接（避免 wait_timeout 掉线）
    kwargs["pool_size"] = settings.DB_POOL_SIZE
    kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
    kwargs["pool_recycle"] = settings.DB_POOL_RECYCLE
    kwargs["pool_timeout"] = settings.DB_POOL_TIMEOUT
    if settings.is_mysql:
        kwargs["connect_args"] = {
            "charset": settings.DB_CHARSET,
            "connect_timeout": 10,
            "read_timeout": 60,
            "write_timeout": 60,
            "autocommit": False,
        }
    return kwargs


engine: Engine = create_engine(settings.database_url, **_engine_kwargs())

if settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # noqa: ANN001
        """开启外键约束与 WAL，保证库存流水的完整性。"""
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
        finally:
            cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：请求级数据库会话。

    异常时回滚、结束时关闭。业务服务内部仍需显式 ``db.commit()``，
    以保证「库存更新 + 流水写入」在同一事务内完成。
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_all_tables() -> None:
    """按 ORM 元数据建表（MVP 阶段替代 Alembic 迁移）。"""
    from app import models  # noqa: F401  确保模型已注册到 Base.metadata

    Base.metadata.create_all(bind=engine)


def check_connection() -> tuple[bool, str]:
    """启动自检：探测数据库连通性，返回 (是否可用, 描述)。"""
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT VERSION()")).scalar()
        return True, str(version)
    except Exception as exc:  # noqa: BLE001 - 启动阶段只记录不抛出
        return False, f"{exc.__class__.__name__}: {exc}"
