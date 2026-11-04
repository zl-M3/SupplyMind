"""pytest 公共夹具：复用演示数据，避免每次测试都重置数据库。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal, create_all_tables
from app.main import app
from app.seed import seed_demo_data


@pytest.fixture(scope="session")
def client() -> TestClient:
    """整个测试会话共用一个 TestClient（会触发 lifespan：建表 + 空库时写演示数据）。"""
    create_all_tables()
    with SessionLocal() as db:
        seed_demo_data(db)
    with TestClient(app) as test_client:
        yield test_client


def _token(client: TestClient, username: str, password: str) -> dict[str, str]:
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin_headers(client: TestClient) -> dict[str, str]:
    return _token(client, "admin", "admin123")


@pytest.fixture(scope="session")
def purchaser_headers(client: TestClient) -> dict[str, str]:
    return _token(client, "purchaser", "purchaser123")


@pytest.fixture(scope="session")
def warehouse_headers(client: TestClient) -> dict[str, str]:
    return _token(client, "warehouse", "warehouse123")


@pytest.fixture(scope="session")
def viewer_headers(client: TestClient) -> dict[str, str]:
    return _token(client, "viewer", "viewer123")
