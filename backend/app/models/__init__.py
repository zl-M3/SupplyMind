"""ORM 模型统一出口。

导入本模块即可保证所有表注册到 ``Base.metadata``（与 ``schema-mysql.sql`` 的 19 张表一一对应）。
"""

from app.models.ai import AIConversation, AIMessage, AIReport, AITask
from app.models.audit import OperationLog
from app.models.base import Base
from app.models.enums import (
    AccountStatus,
    ConfigValueType,
    ContextType,
    LogisticsStatus,
    MasterStatus,
    MessageRole,
    ProductStatus,
    PurchaseOrderStatus,
    ReportType,
    StockStatus,
    SupplierStatus,
    TaskStatus,
    TaskType,
    TransactionType,
    UserRole,
    WarehouseStatus,
)
from app.models.logistics import LogisticsEvent, LogisticsOrder
from app.models.master_data import Product, Supplier, Warehouse
from app.models.purchase import (
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseReceipt,
    PurchaseReceiptItem,
)
from app.models.stock import InventoryTransaction, StockTransfer, WarehouseStock
from app.models.system import SystemConfig
from app.models.user import User

__all__ = [
    # 基类
    "Base",
    # 枚举
    "AccountStatus",
    "ConfigValueType",
    "ContextType",
    "LogisticsStatus",
    "MasterStatus",
    "MessageRole",
    "ProductStatus",
    "PurchaseOrderStatus",
    "ReportType",
    "StockStatus",
    "SupplierStatus",
    "TaskStatus",
    "TaskType",
    "TransactionType",
    "UserRole",
    "WarehouseStatus",
    # 模型
    "AIConversation",
    "AIMessage",
    "AIReport",
    "AITask",
    "InventoryTransaction",
    "LogisticsEvent",
    "LogisticsOrder",
    "OperationLog",
    "Product",
    "PurchaseOrder",
    "PurchaseOrderItem",
    "PurchaseReceipt",
    "PurchaseReceiptItem",
    "StockTransfer",
    "Supplier",
    "SystemConfig",
    "User",
    "Warehouse",
    "WarehouseStock",
]
