"""接口层测试：鉴权、权限、统一错误体、分页，以及关键业务规则的接口表现。"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database_ok"] is True


def test_login_success_and_me(client: TestClient, admin_headers: dict[str, str]) -> None:
    me = client.get("/api/v1/auth/me", headers=admin_headers)
    assert me.status_code == 200
    assert me.json()["username"] == "admin"
    assert me.json()["role"] == "admin"


def test_login_wrong_password(client: TestClient) -> None:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "UNAUTHORIZED"


def test_requires_token(client: TestClient) -> None:
    resp = client.get("/api/v1/inventory")
    assert resp.status_code == 401


def test_pagination_shape(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/products", headers=admin_headers, params={"page": 1, "page_size": 3})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "page", "page_size", "pages"}
    assert len(body["items"]) <= 3


def test_inventory_alerts_only_abnormal(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/inventory/alerts", headers=admin_headers)
    assert resp.status_code == 200
    for item in resp.json()["items"]:
        assert item["status"] in ("low", "out_of_stock")
        assert item["current_quantity"] < item["safety_stock"] or item["current_quantity"] == 0


def test_replenishment_matches_formula(client: TestClient, admin_headers: dict[str, str]) -> None:
    products = client.get("/api/v1/products", headers=admin_headers, params={"page_size": 50}).json()["items"]
    product_id = products[0]["id"]
    resp = client.get(f"/api/v1/inventory/replenishment/{product_id}", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    expected = max(0, body["safety_stock"] - body["current_quantity"] - body["incoming_quantity"])
    assert body["suggested_quantity"] == expected


def test_warehouse_cannot_create_product(client: TestClient, warehouse_headers: dict[str, str]) -> None:
    resp = client.post(
        "/api/v1/products",
        headers=warehouse_headers,
        json={"code": f"T{uuid4().hex[:6]}", "name": "测试商品", "unit": "件", "safety_stock": 1},
    )
    assert resp.status_code == 403


def test_self_approval_forbidden(
    client: TestClient,
    purchaser_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    """创建人不能审批自己创建的采购订单（规划核心规则）。"""
    suppliers = client.get("/api/v1/suppliers", headers=purchaser_headers).json()["items"]
    supplier_id = next(item["id"] for item in suppliers if item["status"] == "active")
    products = client.get("/api/v1/products", headers=purchaser_headers, params={"page_size": 5}).json()["items"]

    created = client.post(
        "/api/v1/purchase-orders",
        headers=purchaser_headers,
        json={
            "supplier_id": supplier_id,
            "remark": "pytest 自审批校验",
            "items": [{"product_id": products[0]["id"], "quantity": 1}],
        },
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]

    assert client.post(f"/api/v1/purchase-orders/{order_id}/submit", headers=purchaser_headers).status_code == 200

    self_approve = client.post(f"/api/v1/purchase-orders/{order_id}/approve", headers=purchaser_headers)
    assert self_approve.status_code == 400
    assert self_approve.json()["code"] == "SELF_APPROVAL_FORBIDDEN"

    other_approve = client.post(f"/api/v1/purchase-orders/{order_id}/approve", headers=admin_headers)
    assert other_approve.status_code == 200
    assert other_approve.json()["status"] == "approved"

    # 清理：取消订单，避免影响演示数据
    client.post(f"/api/v1/purchase-orders/{order_id}/cancel", headers=admin_headers)


def test_receipt_exceeds_remaining(
    client: TestClient,
    admin_headers: dict[str, str],
    purchaser_headers: dict[str, str],
    warehouse_headers: dict[str, str],
) -> None:
    """收货数量不能超过剩余未收数量。"""
    orders = client.get(
        "/api/v1/purchase-orders",
        headers=admin_headers,
        params={"status": "approved", "page_size": 5},
    ).json()["items"]
    if not orders:
        import pytest

        pytest.skip("演示数据没有已审批订单")
    order_id = orders[0]["id"]
    detail = client.get(f"/api/v1/purchase-orders/{order_id}", headers=admin_headers).json()
    item = detail["items"][0]
    warehouses = client.get("/api/v1/warehouses/options", headers=warehouse_headers).json()

    resp = client.post(
        f"/api/v1/purchase-orders/{order_id}/receive",
        headers=warehouse_headers,
        json={
            "warehouse_id": warehouses[0]["id"],
            "items": [{"item_id": item["id"], "quantity": item["remaining_quantity"] + 100}],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "RECEIPT_EXCEEDS_REMAINING"


def test_ai_chat_returns_five_sections(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.post(
        "/api/v1/ai/chat",
        headers=admin_headers,
        json={"content": "现在哪些商品需要补货？"},
    )
    assert resp.status_code == 200
    body = resp.json()
    content = body["assistant_message"]["content"]
    for section in ("结论", "数据依据", "原因分析", "建议动作", "可执行操作"):
        assert section in content
    assert body["mode"] in ("rule", "llm")
    assert body["task"]["task_type"] == "replenishment"
    assert all(call["status"] in ("success", "failed", "rejected") for call in body["tool_calls"])


def test_ai_tools_respect_role(client: TestClient, viewer_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/ai/tools", headers=viewer_headers)
    assert resp.status_code == 200
    names = {tool["name"] for tool in resp.json()}
    assert "query_inventory" in names
    assert "create_purchase_draft" not in names


def test_logistics_refresh_delays(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.post("/api/v1/logistics/refresh-delays", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert {"checked", "newly_delayed", "cleared", "delayed_total"} <= set(body)


def test_dashboard_overview_shape(client: TestClient, admin_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/dashboard/overview", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    for key in ("kpi", "trend", "todos", "alerts", "ai_insights"):
        assert key in body
    assert body["ai_mode"] in ("rule", "llm")
