"""业务规则纯函数测试：库存状态、补货公式、物流延迟天数、金额计算。"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app.models.enums import StockStatus
from app.services.rules import (
    amount_of,
    compute_replenishment,
    delay_days_of,
    replenishment_formula_text,
    stock_status_of,
)


@pytest.mark.parametrize(
    ("quantity", "safety_stock", "expected"),
    [
        (0, 100, StockStatus.OUT_OF_STOCK),
        (-5, 100, StockStatus.OUT_OF_STOCK),
        (50, 100, StockStatus.LOW),
        (99, 100, StockStatus.LOW),
        (100, 100, StockStatus.NORMAL),
        (500, 100, StockStatus.NORMAL),
        (0, 0, StockStatus.OUT_OF_STOCK),
        (10, 0, StockStatus.NORMAL),
    ],
)
def test_stock_status_of(quantity: int, safety_stock: int, expected: StockStatus) -> None:
    assert stock_status_of(quantity, safety_stock) is expected


@pytest.mark.parametrize(
    ("safety_stock", "available", "incoming", "expected"),
    [
        (400, 0, 0, 400),
        (400, 100, 0, 300),
        (400, 100, 200, 100),
        (400, 100, 300, 0),
        (400, 500, 0, 0),
        (400, 0, 400, 0),
        (0, 0, 0, 0),
    ],
)
def test_compute_replenishment(safety_stock: int, available: int, incoming: int, expected: int) -> None:
    assert compute_replenishment(safety_stock, available, incoming) == expected


def test_replenishment_formula_text_contains_source_numbers() -> None:
    text = replenishment_formula_text(400, 100, 50, 250)
    assert "400" in text and "100" in text and "50" in text and "250" in text


def test_delay_days_of() -> None:
    now = datetime(2026, 11, 1, 12, 0, 0)
    assert delay_days_of(now, None) == 0
    assert delay_days_of(now, now + timedelta(days=1)) == 0
    assert delay_days_of(now, now - timedelta(days=3)) == 3
    # 不足一天不算延迟
    assert delay_days_of(now, now - timedelta(hours=5)) == 0


def test_amount_of() -> None:
    assert amount_of(10, Decimal("2.50")) == Decimal("25.00")
    assert amount_of(0, Decimal("9.99")) == Decimal("0.00")
