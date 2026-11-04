"""用户账号服务：``users``（主键 username，角色 GM / SALES）。"""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import AuthError, BusinessRuleError, ConflictError, NotFoundError
from app.core.security import hash_password, verify_password
from app.models import User
from app.models.enums import UserRole
from app.schemas.user import (
    ChangePasswordRequest,
    RoleOption,
    UserCreate,
    UserOut,
    UserUpdate,
)

DEFAULT_ACCOUNTS: tuple[tuple[str, str, str], ...] = (
    ("gm", "张伟", UserRole.GM.value),
    ("sales01", "李娜", UserRole.SALES.value),
)
DEFAULT_PASSWORD = "123456"


def user_to_out(user: User) -> UserOut:
    return UserOut.model_validate(user)


def get_user(db: Session, username: str) -> User:
    user = db.get(User, username)
    if user is None:
        raise NotFoundError("用户不存在")
    return user


def get_by_username(db: Session, username: str) -> User | None:
    return db.get(User, username)


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.get(User, username)
    if user is None or not verify_password(password, user.password):
        raise AuthError("账号或密码不正确")
    if not user.is_active:
        raise AuthError("账号已停用，请联系管理者", code="ACCOUNT_DISABLED")
    return user


def list_users(
    db: Session,
    *,
    keyword: str | None = None,
    role: str | None = None,
    status: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[UserOut], int]:
    stmt = select(User)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(User.username.like(like), User.display_name.like(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if status is not None:
        stmt = stmt.where(User.status == status)

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(User.role.desc(), User.username)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [user_to_out(item) for item in rows], total


def create_user(db: Session, payload: UserCreate) -> User:
    username = payload.username.strip()
    if db.get(User, username) is not None:
        raise ConflictError(f"账号已存在：{username}", code="USERNAME_EXISTS")
    user = User(
        username=username,
        password=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        role=payload.role.value,
        status=int(payload.status),
    )
    db.add(user)
    db.flush()
    return user


def update_user(
    db: Session, username: str, payload: UserUpdate, *, current_user: User
) -> User:
    user = get_user(db, username)
    data = payload.model_dump(exclude_unset=True)

    if user.username == current_user.username:
        if data.get("status") == 0:
            raise BusinessRuleError("不能停用自己的账号", code="CANNOT_DISABLE_SELF")
        if "role" in data and data["role"] is not None and getattr(
            data["role"], "value", data["role"]
        ) != user.role:
            raise BusinessRuleError("不能修改自己的角色", code="CANNOT_CHANGE_OWN_ROLE")

    new_role = data.get("role")
    if new_role is not None:
        new_role_value = getattr(new_role, "value", new_role)
        if user.role == UserRole.GM.value and new_role_value != UserRole.GM.value:
            if count_active_gm(db) <= 1:
                raise BusinessRuleError(
                    "系统至少需要保留一个启用状态的管理者账号", code="LAST_GM_PROTECTED"
                )
        user.role = new_role_value

    if "display_name" in data and data["display_name"]:
        user.display_name = data["display_name"].strip()
    if "status" in data and data["status"] is not None:
        if user.role == UserRole.GM.value and int(data["status"]) == 0 and count_active_gm(db) <= 1:
            raise BusinessRuleError(
                "系统至少需要保留一个启用状态的管理者账号", code="LAST_GM_PROTECTED"
            )
        user.status = int(data["status"])

    db.flush()
    return user


def change_password(db: Session, user: User, payload: ChangePasswordRequest) -> None:
    if not verify_password(payload.old_password, user.password):
        raise BusinessRuleError("原密码不正确", code="OLD_PASSWORD_MISMATCH")
    if payload.old_password == payload.new_password:
        raise BusinessRuleError("新密码不能与原密码相同", code="PASSWORD_UNCHANGED")
    user.password = hash_password(payload.new_password)
    db.flush()


def reset_password(db: Session, username: str, new_password: str) -> User:
    user = get_user(db, username)
    user.password = hash_password(new_password)
    db.flush()
    return user


def role_options() -> list[RoleOption]:
    return [RoleOption(value=item.value, label=item.label) for item in UserRole]


def count_active_gm(db: Session) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.GM.value, User.status == 1)
        )
        or 0
    )


def ensure_default_accounts(db: Session) -> list[str]:
    """空库时创建默认账号，返回新建的账号列表。"""
    if int(db.scalar(select(func.count()).select_from(User)) or 0) > 0:
        return []

    created: list[str] = []
    for username, display_name, role in DEFAULT_ACCOUNTS:
        db.add(
            User(
                username=username,
                password=hash_password(DEFAULT_PASSWORD),
                display_name=display_name,
                role=role,
                status=1,
            )
        )
        created.append(username)
    db.flush()
    return created
