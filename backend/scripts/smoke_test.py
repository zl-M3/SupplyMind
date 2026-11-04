"""端到端冒烟测试：不启动真实服务器，直接用 TestClient 跑一遍核心闭环。

运行::

    python scripts/smoke_test.py

覆盖：
1. 健康检查 / 登录鉴权
2. 工作台总览、库存预警
3. AI 场景一：库存分析 + 补货 + 生成采购草稿 → 用户确认落库
4. 采购闭环：提交 → 他人审批（创建人不能审批自己的单）→ 部分收货入库（库存 + 流水同事务）
5. 物流场景：刷新延迟、物流异常分析报告
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: F401,E402  注册元数据
from app.core.database import Base, create_all_tables, engine  # noqa: E402
from app.main import app  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  [PASS] {name}")
    else:
        FAILED.append(name)
        print(f"  [FAIL] {name} -> {detail}")


def login(client: TestClient, username: str, password: str) -> str:
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def main() -> int:
    keep_data = "--keep-data" in sys.argv
    if not keep_data:
        # 每次自测前重置数据，避免上一轮残留的采购单影响补货建议量
        Base.metadata.drop_all(bind=engine)
        create_all_tables()
        print("已重置数据库，将重新写入演示数据")

    with TestClient(app) as client:
        print("\n=== 1. 健康检查 / 登录 ===")
        health = client.get("/health")
        check("GET /health", health.status_code == 200, health.text)
        print(f"       数据库: {health.json().get('database')}  AI 模式: {health.json().get('ai_mode')}")

        admin = login(client, "admin", "admin123")
        purchaser = login(client, "purchaser", "purchaser123")
        warehouse = login(client, "warehouse", "warehouse123")
        check("三种角色登录成功", bool(admin and purchaser and warehouse))

        me = client.get("/api/v1/auth/me", headers=auth(admin))
        check("GET /auth/me", me.status_code == 200 and me.json()["username"] == "admin", me.text)

        no_token = client.get("/api/v1/inventory")
        check("未登录访问被拒绝(401)", no_token.status_code == 401, no_token.status_code)

        print("\n=== 2. 工作台 / 库存预警 ===")
        overview = client.get("/api/v1/dashboard/overview", headers=auth(admin))
        check("GET /dashboard/overview", overview.status_code == 200, overview.text)
        data = overview.json()
        print(f"       待审批: {data['kpi']['pending_approval_count']}  延迟物流: {data['kpi']['delayed_logistics_count']}  低库存: {data['kpi']['low_stock_count']}")

        alerts = client.get("/api/v1/inventory/alerts", headers=auth(admin))
        check("GET /inventory/alerts", alerts.status_code == 200 and alerts.json()["total"] > 0, alerts.text)
        alert_items = alerts.json()["items"]
        out_of_stock = [item for item in alert_items if item["status"] == "out_of_stock"]
        check("存在缺货商品（演示数据）", len(out_of_stock) > 0, alert_items[:2])
        target = out_of_stock[0] if out_of_stock else alert_items[0]
        print(f"       目标商品: {target['product_name']} 当前库存 {target['current_quantity']} 安全库存 {target['safety_stock']}")

        summary = client.get("/api/v1/inventory/summary", headers=auth(admin))
        check("GET /inventory/summary", summary.status_code == 200, summary.text)

        print("\n=== 3. AI 场景一：库存分析 + 补货草稿 ===")
        chat = client.post(
            "/api/v1/ai/chat",
            headers=auth(admin),
            json={"content": f"{target['product_name']}库存不够了，帮我算一下要补多少，并生成采购草稿"},
        )
        check("POST /ai/chat", chat.status_code == 200, chat.text)
        payload = chat.json()
        print(f"       AI 模式: {payload['mode']}  工具调用: {[t['name'] for t in payload['tool_calls']]}")
        answer = payload["assistant_message"]["content"]
        for section in ("结论", "数据依据", "原因分析", "建议动作", "可执行操作"):
            check(f"AI 回复包含「{section}」段", section in answer, answer[:200])

        confirmation = payload.get("confirmation")
        check("生成了待确认的采购草稿", confirmation is not None, payload.get("task"))
        task_id = payload["task"]["id"]
        check("任务状态为 awaiting_confirmation", payload["task"]["status"] == "awaiting_confirmation", payload["task"]["status"])

        if confirmation:
            confirm = client.post(
                f"/api/v1/ai/tasks/{task_id}/confirm",
                headers=auth(admin),
                json={"items": confirmation["items"], "expected_arrival_date": confirmation.get("expected_arrival_date")},
            )
            check("确认后创建采购草稿", confirm.status_code == 200, confirm.text)
            order_id = confirm.json()["order_id"]
            order_no = confirm.json()["order_no"]
            print(f"       已生成采购单 {order_no} (id={order_id})")

            print("\n=== 4. 采购闭环：提交 → 他人审批 → 收货入库 ===")
            submit = client.post(f"/api/v1/purchase-orders/{order_id}/submit", headers=auth(admin))
            check("提交审批", submit.status_code == 200 and submit.json()["status"] == "pending_approval", submit.text)

            self_approve = client.post(f"/api/v1/purchase-orders/{order_id}/approve", headers=auth(admin))
            check(
                "创建人不能审批自己的订单(400)",
                self_approve.status_code == 400 and self_approve.json()["code"] == "SELF_APPROVAL_FORBIDDEN",
                self_approve.text,
            )

            approve = client.post(f"/api/v1/purchase-orders/{order_id}/approve", headers=auth(purchaser))
            check("他人审批通过", approve.status_code == 200 and approve.json()["status"] == "approved", approve.text)

            order = approve.json()
            item = order["items"][0]
            warehouses = client.get("/api/v1/warehouses/options", headers=auth(warehouse)).json()
            warehouse_id = warehouses[0]["id"]

            before = client.get(f"/api/v1/inventory/replenishment/{item['product_id']}", headers=auth(admin)).json()
            receive_qty = 5
            receive = client.post(
                f"/api/v1/purchase-orders/{order_id}/receive",
                headers=auth(warehouse),
                json={"warehouse_id": warehouse_id, "items": [{"item_id": item["id"], "quantity": receive_qty}]},
            )
            check("收货入库", receive.status_code == 200, receive.text)
            after_order = receive.json()
            check(
                "部分收货后状态为 partially_received",
                after_order["status"] == "partially_received",
                after_order["status"],
            )

            over = client.post(
                f"/api/v1/purchase-orders/{order_id}/receive",
                headers=auth(warehouse),
                json={"warehouse_id": warehouse_id, "items": [{"item_id": item["id"], "quantity": 999999}]},
            )
            check(
                "超量收货被拒绝(400)",
                over.status_code == 400 and over.json()["code"] == "RECEIPT_EXCEEDS_REMAINING",
                over.text,
            )

            after = client.get(f"/api/v1/inventory/replenishment/{item['product_id']}", headers=auth(admin)).json()
            check(
                "库存与未收数量同步更新",
                after["current_quantity"] == before["current_quantity"] + receive_qty,
                (before["current_quantity"], after["current_quantity"]),
            )

            receipts = client.get(f"/api/v1/purchase-orders/{order_id}/receipts", headers=auth(admin))
            check("收货记录已生成", receipts.status_code == 200 and len(receipts.json()) >= 1, receipts.text)

            txns = client.get(
                "/api/v1/inventory/transactions",
                headers=auth(admin),
                params={"reference_type": "purchase_order", "reference_id": order_id},
            )
            check("库存流水已写入（同事务）", txns.status_code == 200 and txns.json()["total"] >= 1, txns.text)

        print("\n=== 5. 物流：延迟刷新 + 异常分析 ===")
        refresh = client.post("/api/v1/logistics/refresh-delays", headers=auth(admin))
        check("POST /logistics/refresh-delays", refresh.status_code == 200, refresh.text)
        print(f"       检查 {refresh.json()['checked']} 单，延迟 {refresh.json()['delayed_total']} 单")

        delayed = client.get("/api/v1/logistics", headers=auth(admin), params={"only_delayed": True})
        check("存在延迟物流单", delayed.status_code == 200 and delayed.json()["total"] > 0, delayed.text)
        logistics_id = delayed.json()["items"][0]["id"]

        analysis = client.post(f"/api/v1/ai/analyze/logistics/{logistics_id}", headers=auth(admin))
        check("POST /ai/analyze/logistics/{id}", analysis.status_code == 200, analysis.text)
        if analysis.status_code == 200:
            content = analysis.json()["content"]
            check("物流分析报告含结论与建议", bool(content["conclusion"] and content["suggestions"]), content)

        print("\n=== 6. 调拨 / 权限 ===")
        whs = client.get("/api/v1/warehouses/options", headers=auth(admin)).json()
        products = client.get("/api/v1/products", headers=auth(admin), params={"page_size": 5}).json()["items"]
        product_id = products[0]["id"]
        transfer = client.post(
            "/api/v1/stock-transfers",
            headers=auth(warehouse),
            json={
                "from_warehouse_id": whs[0]["id"],
                "to_warehouse_id": whs[1]["id"],
                "items": [{"product_id": product_id, "quantity": 1}],
            },
        )
        check(
            "调拨成功或库存不足被拦截",
            transfer.status_code in (201, 400),
            transfer.text,
        )

        forbidden = client.post(
            "/api/v1/products",
            headers=auth(warehouse),
            json={"code": "PTEST", "name": "测试商品", "unit": "件", "safety_stock": 1},
        )
        check("仓库角色无商品创建权限(403)", forbidden.status_code == 403, forbidden.status_code)

    print("\n" + "=" * 60)
    print(f"通过 {len(PASSED)} 项，失败 {len(FAILED)} 项")
    if FAILED:
        for name in FAILED:
            print(f"  FAILED: {name}")
        return 1
    print("全部通过 ✅")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
