/**
 *   领域模型
 *
 * 这些类型与《MVP 模块精简版规划》第 7 节的表结构一一对应：
 * suppliers / products / warehouses / warehouse_stock / purchase_orders /
 * purchase_order_items / inventory_transactions / logistics_orders /
 * logistics_events / stock_transfers / ai_conversations / ai_messages /
 * ai_tasks / operation_logs
 *
 * 接入后端时，这里就是前后端契约的唯一来源。
 */

export type Role = 'admin' | 'buyer';

export interface User {
  id: string;
  name: string;
  role: Role;
  department: string;
}

/* ------------------------- 供应商 ------------------------- */

export type SupplierStatus = 'active' | 'disabled';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact: string;
  phone: string;
  categories: string[];
  status: SupplierStatus;
  address: string;
  createdAt: string;
  remark?: string;
}

/** 供应商履约指标：样本不足时 onTimeRate 为 null（前端显示“数据不足”） */
export interface SupplierMetrics {
  orderCount: number;
  completedCount: number;
  delayCount: number;
  onTimeRate: number | null;
}

/* ------------------------- 商品 / 仓库 / 库存 ------------------------- */

export type ProductStatus = 'active' | 'disabled';

export interface Product {
  id: string;
  code: string;
  name: string;
  /** 商品大类，与供应商可供应的品类对应 */
  category: string;
  /** 商品小类；采购下单时按小类挑选商品 */
  subCategory: string;
  spec: string;
  unit: string;
  safetyStock: number;
  purchasePrice: number;
  status: ProductStatus;
  createdAt: string;
}

export type WarehouseStatus = 'active' | 'disabled';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string;
  manager: string;
  phone: string;
  status: WarehouseStatus;
  createdAt: string;
}

export interface WarehouseStock {
  id: string;
  productId: string;
  warehouseId: string;
  qty: number;
}

/** 库存状态：缺货 / 低库存 / 正常 */
export type StockLevel = 'out' | 'low' | 'normal';

/** 库存总览行：一个商品 + 各仓库分布 */
export interface StockOverviewRow {
  productId: string;
  productCode: string;
  productName: string;
  spec: string;
  unit: string;
  category: string;
  safetyStock: number;
  totalQty: number;
  level: StockLevel;
  /** 缺口 = max(0, 安全库存 - 当前库存) */
  gap: number;
  /** 已审批未收货数量（用于补货建议） */
  inTransitQty: number;
  /** 建议采购量 = max(0, 安全库存 - 当前库存 - 已审批未收货) */
  suggestedQty: number;
  warehouses: Array<{ warehouseId: string; warehouseName: string; qty: number }>;
}

/* ------------------------- 库存流水 / 调拨 ------------------------- */

export type TransactionType = 'purchase_in' | 'transfer_in' | 'transfer_out';

export interface InventoryTransaction {
  id: string;
  type: TransactionType;
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  /** 带符号：入库为正，出库为负 */
  qty: number;
  beforeQty: number;
  afterQty: number;
  refCode: string;
  operator: string;
  createdAt: string;
  remark?: string;
}

export interface StockTransfer {
  id: string;
  code: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  productId: string;
  productName: string;
  qty: number;
  operator: string;
  createdAt: string;
  remark?: string;
}

/* ------------------------- 采购订单 ------------------------- */

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'partial'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  spec: string;
  unit: string;
  qty: number;
  receivedQty: number;
  price: number;
  amount: number;
}

export interface PurchaseOrder {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expectedArrival: string;
  status: PurchaseOrderStatus;
  approverId?: string;
  approverName?: string;
  approvedAt?: string;
  rejectReason?: string;
  remark?: string;
  /** 已创建物流单时回填 */
  logisticsId?: string;
}

/* ------------------------- 收货记录 ------------------------- */

/** 一次收货（purchase_receipts + purchase_receipt_items） */
export interface ReceiptRecord {
  id: string;
  code: string;
  warehouseName: string;
  receivedBy: string;
  receivedAt: string;
  remark?: string;
  items: Array<{
    id: number;
    poItemId: string;
    productName: string;
    qty: number;
  }>;
}

/* ------------------------- 物流 ------------------------- */

export type LogisticsStatus = 'pending' | 'in_transit' | 'arrived' | 'delivered' | 'exception';

export interface LogisticsEvent {
  id: string;
  time: string;
  node: string;
  desc: string;
  location: string;
}

export interface LogisticsOrder {
  id: string;
  code: string;
  poId: string;
  poCode: string;
  supplierId: string;
  supplierName: string;
  carrier: string;
  trackingNo: string;
  expectedArrival: string;
  status: LogisticsStatus;
  /** 超过预计到达时间且未送达 → true */
  delayed: boolean;
  events: LogisticsEvent[];
  remark?: string;
}

/* ------------------------- AI ------------------------- */

export interface ToolCallLog {
  name: string;
  params: string;
  status: 'success' | 'failed';
  durationMs: number;
}

/** AI 回复统一结构：结论 / 数据依据 / 原因分析 / 建议动作 / 可执行操作 */
export interface AiEvidence {
  label: string;
  value: string;
}

export interface PurchaseDraftPayload {
  supplierId: string;
  supplierName: string;
  items: Array<{
    productId: string;
    productName: string;
    spec: string;
    unit: string;
    qty: number;
    price: number;
  }>;
  totalAmount: number;
  /** 数据依据 / 计算口径 */
  basis: string[];
  expectedArrival: string;
}

export interface AiCitation {
  title: string;
  section?: string;
  score?: number;
  snippet?: string;
}

export interface AiReply {
  conclusion: string;
  evidence: AiEvidence[];
  cause?: string;
  actions: string[];
  /** 可执行操作：目前支持“生成采购草稿”确认卡片 */
  draft?: PurchaseDraftPayload;
  toolCalls: ToolCallLog[];
  taskId?: string;
  reportId?: string;
  /** RAG 引用来源 */
  citations?: AiCitation[];
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  reply?: AiReply;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
}

/** 会话列表项：不含消息明细，数据库列表接口直接返回 */
export interface AiConversationBrief {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentTaskType =
  | 'replenishment'
  | 'logistics_analysis'
  | 'supplier_analysis'
  | 'purchase_draft';

export type AgentTaskStatus = 'pending' | 'running' | 'waiting_confirm' | 'done' | 'failed';

export interface AgentTask {
  id: string;
  name: string;
  type: AgentTaskType;
  createdBy: string;
  createdAt: string;
  status: AgentTaskStatus;
  summary: string;
  toolCalls: ToolCallLog[];
  /** 待确认任务的草稿载荷 */
  payload?: PurchaseDraftPayload;
  resultText?: string;
  error?: string;
}

export type AiReportType = 'supplier_risk' | 'replenishment' | 'logistics_anomaly';

export interface AiReport {
  id: string;
  type: AiReportType;
  title: string;
  targetName: string;
  targetId: string;
  createdAt: string;
  conclusion: string;
  evidence: AiEvidence[];
  cause: string;
  suggestions: string[];
}

/* ------------------------- 页面上下文 ------------------------- */

/** 从业务页面唤起 AI 时携带的上下文，帮助 Agent 理解意图 */
export interface AiPageContext {
  /** 例如 供应商详情 / 采购订单详情 / 物流详情 / 库存预警 */
  pageName: string;
  /** 关联业务对象 ID */
  targetId?: string;
  targetName?: string;
  /** 预填问题 */
  presetQuestion?: string;
}

/* ------------------------- 通用 ------------------------- */

export interface PageQuery {
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface PageResult<T> {
  list: T[];
  total: number;
}

