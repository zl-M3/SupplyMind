/**
 * 业务规则（纯函数，全部基于传入的数据快照计算）
 *
 * 这些规则与 PRD 一一对应，接后端后应以后端为准；
 * 前端保留它们只是为了列表展示和 AI 建议的口径一致。
 */

import dayjs from 'dayjs';
import type { Db } from '@/mock/db';
import type {
  LogisticsOrder,
  PurchaseOrder,
  StockLevel,
  StockOverviewRow,
  SupplierMetrics,
} from '@/types';

/** 可以收货的订单状态 */
export const RECEIVABLE_STATUS: PurchaseOrder['status'][] = ['approved', 'partial'];

export const isReceivable = (po: PurchaseOrder) => RECEIVABLE_STATUS.includes(po.status);

export const remainingQty = (po: PurchaseOrder) =>
  po.items.reduce((sum, i) => sum + Math.max(0, i.qty - i.receivedQty), 0);

/** 库存状态：0 → 缺货；< 安全库存 → 低库存；其他 → 正常 */
export function stockLevelOf(totalQty: number, safetyStock: number): StockLevel {
  if (totalQty <= 0) return 'out';
  if (totalQty < safetyStock) return 'low';
  return 'normal';
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  out: '缺货',
  low: '低库存',
  normal: '正常',
};

/** 已审批未收货数量（用于补货建议） */
export function inTransitQty(db: Db, productId: string): number {
  return db.purchaseOrders
    .filter((po) => po.status === 'approved' || po.status === 'partial')
    .flatMap((po) => po.items)
    .filter((i) => i.productId === productId)
    .reduce((sum, i) => sum + Math.max(0, i.qty - i.receivedQty), 0);
}

/**
 * 建议采购量 = max(0, 安全库存目标 − 当前可用库存 − 已审批未收货数量)
 * 对应 PRD 2.3-C 的首期公式，不做销量预测。
 */
export function suggestedPurchaseQty(db: Db, productId: string): number {
  const product = db.products.find((p) => p.id === productId);
  if (!product) return 0;
  const current = db.warehouseStock
    .filter((s) => s.productId === productId)
    .reduce((sum, s) => sum + s.qty, 0);
  const transit = inTransitQty(db, productId);
  return Math.max(0, product.safetyStock - current - transit);
}

/** 库存总览：一个商品一行，含各仓库分布、缺口、建议采购量 */
export function buildStockOverview(db: Db, statusFilter?: 'active'): StockOverviewRow[] {
  return db.products
    .filter((p) => (statusFilter === 'active' ? p.status === 'active' : true))
    .map((p) => {
      const rows = db.warehouseStock.filter((s) => s.productId === p.id);
      const totalQty = rows.reduce((sum, r) => sum + r.qty, 0);
      const transit = inTransitQty(db, p.id);
      return {
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        spec: p.spec,
        unit: p.unit,
        category: p.category,
        safetyStock: p.safetyStock,
        totalQty,
        level: stockLevelOf(totalQty, p.safetyStock),
        gap: Math.max(0, p.safetyStock - totalQty),
        inTransitQty: transit,
        suggestedQty: Math.max(0, p.safetyStock - totalQty - transit),
        warehouses: db.warehouses.map((w) => ({
          warehouseId: w.id,
          warehouseName: w.name,
          qty: rows.find((r) => r.warehouseId === w.id)?.qty ?? 0,
        })),
      };
    });
}

/**
 * 供应商履约指标
 * 准时交付率 = 准时签收单数 / 已签收单数
 * 只有「已签收（delivered）」的物流单才可判定；在途/待发货的不计入分子分母，
 * 否则一张还在路上的单会被当成"未准时"，把准时率拉低。
 * 样本 0 单时返回 null，前端显示“数据不足”。
 */
export function supplierMetrics(db: Db, supplierId: string): SupplierMetrics {
  const completed = db.purchaseOrders.filter(
    (po) => po.supplierId === supplierId && po.status === 'completed' && !!po.expectedArrival,
  );
  const judged = completed
    .map((po) => db.logisticsOrders.find((l) => l.poId === po.id))
    .filter(
      (lo): lo is (typeof db.logisticsOrders)[number] =>
        Boolean(lo) && lo?.status === 'delivered',
    );
  const delayCount = judged.filter((lo) => lo.delayed).length;
  const sample = judged.length;
  return {
    orderCount: db.purchaseOrders.filter((po) => po.supplierId === supplierId).length,
    completedCount: sample,
    delayCount,
    // 只要交付过 1 单就能算准时率，不要求大样本
    onTimeRate: sample < 1 ? null : Number(((sample - delayCount) / sample).toFixed(4)),
  };
}

/** 物流是否延迟：未送达且已超过预计到达时间 */
export function isLogisticsDelayed(lo: LogisticsOrder): boolean {
  if (lo.status === 'delivered') return false;
  return dayjs(lo.expectedArrival).isBefore(dayjs());
}

export const LOGISTICS_STATUS_LABEL: Record<LogisticsOrder['status'], string> = {
  pending: '待发货',
  in_transit: '运输中',
  arrived: '已到达',
  delivered: '已签收',
  exception: '异常',
};

export const PO_STATUS_LABEL: Record<PurchaseOrder['status'], string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已审批',
  partial: '部分收货',
  completed: '已完成',
  rejected: '已驳回',
  cancelled: '已取消',
};

/** 逾期未交付的采购单（用于待办 / 异常提醒） */
export function overduePurchaseOrders(db: Db): PurchaseOrder[] {
  return db.purchaseOrders.filter((po) => {
    if (!isReceivable(po)) return false;
    return dayjs(po.expectedArrival).isBefore(dayjs()) && remainingQty(po) > 0;
  });
}
