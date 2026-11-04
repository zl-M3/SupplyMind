"""业务枚举：取值范围与 ``schema-mysql.sql`` 中的 CHECK 约束完全一致。

数据库里存字符串/小整数，接口层用这些枚举做入参校验与展示文案。
"""

from __future__ import annotations

from enum import Enum


# --------------------------------------------------------------------------- #
# 账号与系统
# --------------------------------------------------------------------------- #
_USER_ROLE_LABELS = {"GM": "管理者", "SALES": "采购员"}


class UserRole(str, Enum):
    """账号角色：只有两个值（与 users.role 的 CHECK 一致）。"""

    GM = "GM"
    SALES = "SALES"

    @property
    def label(self) -> str:
        return _USER_ROLE_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


_ACCOUNT_STATUS_LABELS = {1: "启用", 0: "停用"}


class AccountStatus(int, Enum):
    """users.status：SMALLINT 0/1。"""

    DISABLED = 0
    ENABLED = 1

    @property
    def label(self) -> str:
        return _ACCOUNT_STATUS_LABELS[self.value]


# --------------------------------------------------------------------------- #
# 主数据
# --------------------------------------------------------------------------- #
_MASTER_STATUS_LABELS = {"active": "启用", "disabled": "停用"}


class MasterStatus(str, Enum):
    """suppliers / products / warehouses 的 status。"""

    ACTIVE = "active"
    DISABLED = "disabled"

    @property
    def label(self) -> str:
        return _MASTER_STATUS_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


SupplierStatus = MasterStatus
ProductStatus = MasterStatus
WarehouseStatus = MasterStatus


# --------------------------------------------------------------------------- #
# 库存
# --------------------------------------------------------------------------- #
_STOCK_STATUS_LABELS = {"normal": "正常", "low": "低库存", "out_of_stock": "缺货"}


class StockStatus(str, Enum):
    """库存健康度（接口计算，不落库）。"""

    NORMAL = "normal"
    LOW = "low"
    OUT_OF_STOCK = "out_of_stock"

    @property
    def label(self) -> str:
        return _STOCK_STATUS_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


_TX_TYPE_LABELS = {
    "purchase_in": "采购入库",
    "transfer_in": "调拨入库",
    "transfer_out": "调拨出库",
}


class TransactionType(str, Enum):
    """inventory_transactions.type，只有三种取值。"""

    PURCHASE_IN = "purchase_in"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"

    @property
    def label(self) -> str:
        return _TX_TYPE_LABELS[self.value]

    @property
    def sign(self) -> int:
        """入库 +1，出库 -1。"""
        return -1 if self is TransactionType.TRANSFER_OUT else 1

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


# --------------------------------------------------------------------------- #
# 采购
# --------------------------------------------------------------------------- #
_PO_STATUS_LABELS = {
    "draft": "草稿",
    "pending": "待审批",
    "approved": "已审批",
    "partial": "部分收货",
    "completed": "已完成",
    "rejected": "已驳回",
    "cancelled": "已取消",
}


class PurchaseOrderStatus(str, Enum):
    """purchase_orders.status：草稿→待审批→已审批→部分收货→已完成；驳回/取消为结束分支。"""

    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    PARTIAL = "partial"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"

    @property
    def label(self) -> str:
        return _PO_STATUS_LABELS[self.value]

    @property
    def is_open(self) -> bool:
        """是否仍在流程中（不能删除/需要跟进）。"""
        return self in {
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.PENDING,
            PurchaseOrderStatus.APPROVED,
            PurchaseOrderStatus.PARTIAL,
        }

    @property
    def is_receivable(self) -> bool:
        """是否允许继续收货。"""
        return self in {PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL}

    @property
    def is_final(self) -> bool:
        return self in {
            PurchaseOrderStatus.COMPLETED,
            PurchaseOrderStatus.REJECTED,
            PurchaseOrderStatus.CANCELLED,
        }

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


# --------------------------------------------------------------------------- #
# 物流
# --------------------------------------------------------------------------- #
_LOGISTICS_STATUS_LABELS = {
    "pending": "待发货",
    "in_transit": "运输中",
    "arrived": "已到达",
    "delivered": "已签收",
    "exception": "异常",
}


class LogisticsStatus(str, Enum):
    """logistics_orders.status。"""

    PENDING = "pending"
    IN_TRANSIT = "in_transit"
    ARRIVED = "arrived"
    DELIVERED = "delivered"
    EXCEPTION = "exception"

    @property
    def label(self) -> str:
        return _LOGISTICS_STATUS_LABELS[self.value]

    @property
    def is_final(self) -> bool:
        return self is LogisticsStatus.DELIVERED

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


# --------------------------------------------------------------------------- #
# AI 智能中心
# --------------------------------------------------------------------------- #
_TASK_TYPE_LABELS = {
    "inventory_analysis": "库存分析",
    "replenishment": "补货测算",
    "purchase_draft": "采购草稿",
    "logistics_anomaly": "物流异常",
    "supplier_risk": "供应商风险",
    "knowledge_qa": "业务知识问答",
    "general_qa": "综合问答",
}


class TaskType(str, Enum):
    """ai_tasks.type。"""

    INVENTORY_ANALYSIS = "inventory_analysis"
    REPLENISHMENT = "replenishment"
    PURCHASE_DRAFT = "purchase_draft"
    LOGISTICS_ANOMALY = "logistics_anomaly"
    SUPPLIER_RISK = "supplier_risk"
    KNOWLEDGE_QA = "knowledge_qa"
    GENERAL_QA = "general_qa"

    @property
    def label(self) -> str:
        return _TASK_TYPE_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


_TASK_STATUS_LABELS = {
    "pending": "排队中",
    "running": "执行中",
    "waiting_confirm": "等待确认",
    "done": "已完成",
    "failed": "失败",
}


class TaskStatus(str, Enum):
    """ai_tasks.status。"""

    PENDING = "pending"
    RUNNING = "running"
    WAITING_CONFIRM = "waiting_confirm"
    DONE = "done"
    FAILED = "failed"

    @property
    def label(self) -> str:
        return _TASK_STATUS_LABELS[self.value]

    @property
    def is_open(self) -> bool:
        return self in {TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.WAITING_CONFIRM}

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


_REPORT_TYPE_LABELS = {
    "replenishment": "补货分析报告",
    "supplier_risk": "供应商风险报告",
    "logistics_anomaly": "物流异常报告",
}


class ReportType(str, Enum):
    """ai_reports.type，只有三种。"""

    REPLENISHMENT = "replenishment"
    SUPPLIER_RISK = "supplier_risk"
    LOGISTICS_ANOMALY = "logistics_anomaly"

    @property
    def label(self) -> str:
        return _REPORT_TYPE_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]


_MESSAGE_ROLE_LABELS = {"user": "用户", "assistant": "AI"}


class MessageRole(str, Enum):
    """ai_messages.role。"""

    USER = "user"
    ASSISTANT = "assistant"

    @property
    def label(self) -> str:
        return _MESSAGE_ROLE_LABELS[self.value]


# --------------------------------------------------------------------------- #
# 其它
# --------------------------------------------------------------------------- #
_CONFIG_VALUE_TYPES = {"string": "文本", "int": "整数", "bool": "开关", "decimal": "小数"}


class ConfigValueType(str, Enum):
    """system_configs.value_type。"""

    STRING = "string"
    INT = "int"
    BOOL = "bool"
    DECIMAL = "decimal"

    @property
    def label(self) -> str:
        return _CONFIG_VALUE_TYPES[self.value]


_CONTEXT_TYPE_LABELS = {
    "none": "通用对话",
    "supplier": "供应商",
    "product": "商品",
    "purchase_order": "采购订单",
    "logistics": "物流单",
    "warehouse": "仓库",
    "dashboard": "工作台",
}


class ContextType(str, Enum):
    """AI 对话的业务上下文（接口层使用，不落库）。"""

    NONE = "none"
    SUPPLIER = "supplier"
    PRODUCT = "product"
    PURCHASE_ORDER = "purchase_order"
    LOGISTICS = "logistics"
    WAREHOUSE = "warehouse"
    DASHBOARD = "dashboard"

    @property
    def label(self) -> str:
        return _CONTEXT_TYPE_LABELS[self.value]

    @classmethod
    def options(cls) -> list[dict[str, str]]:
        return [{"value": item.value, "label": item.label} for item in cls]
