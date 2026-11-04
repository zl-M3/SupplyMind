"""v1 版本路由聚合。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    ai,
    auth,
    dashboard,
    dify,
    export,
    inventory,
    logistics,
    master_data,
    purchase_orders,
    suppliers,
    system,
    transfers,
    users,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(dashboard.router)
api_router.include_router(suppliers.router)
api_router.include_router(master_data.products_router)
api_router.include_router(master_data.warehouses_router)
api_router.include_router(inventory.router)
api_router.include_router(purchase_orders.router)
api_router.include_router(logistics.router)
api_router.include_router(transfers.router)
api_router.include_router(ai.router)
api_router.include_router(dify.router)
api_router.include_router(system.router)
api_router.include_router(export.router)
