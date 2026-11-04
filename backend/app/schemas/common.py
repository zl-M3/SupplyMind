"""公共 Schema：分页、消息、枚举字典。"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.utils import calc_pages

T = TypeVar("T")


class ORMModel(BaseModel):
    """可从 ORM 对象直接构造的基类。"""

    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    """统一分页结构。"""

    items: list[T] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20
    pages: int = 0

    @classmethod
    def build(cls, items: list[T], total: int, page: int, page_size: int) -> "Page[T]":
        return cls(items=items, total=total, page=page, page_size=page_size, pages=calc_pages(total, page_size))


class MessageOut(BaseModel):
    message: str
    success: bool = True


class StatusOption(BaseModel):
    value: str
    label: str


class ErrorResponse(BaseModel):
    code: str
    message: str
    detail: object | None = None
