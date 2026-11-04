"""统一业务异常。

所有业务校验失败都通过 ``AppError`` 的子类抛出，由 ``main.py`` 中的异常处理器
转换为统一错误结构::

    {"code": "ORDER_STATUS_INVALID", "message": "订单当前状态不允许审批", "detail": {...}}
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """业务异常基类。"""

    status_code: int = 400
    code: str = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        detail: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.detail = detail

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.detail is not None:
            body["detail"] = self.detail
        return body


class AuthError(AppError):
    """未认证 / Token 失效。"""

    status_code = 401
    code = "UNAUTHORIZED"


class PermissionDeniedError(AppError):
    """无权限。"""

    status_code = 403
    code = "FORBIDDEN"


class NotFoundError(AppError):
    """资源不存在。"""

    status_code = 404
    code = "NOT_FOUND"


class ConflictError(AppError):
    """状态冲突 / 唯一约束冲突。"""

    status_code = 409
    code = "CONFLICT"


class BusinessRuleError(AppError):
    """业务规则校验失败。"""

    status_code = 400
    code = "BUSINESS_RULE_VIOLATION"


class ValidationFailure(AppError):
    """参数校验失败。"""

    status_code = 422
    code = "VALIDATION_ERROR"
