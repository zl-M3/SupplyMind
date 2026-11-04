/**
 * API 层（当前为 Mock 实现）
 *
 * 所有页面只依赖这里的函数签名。接入后端时：
 *   1. 删掉 mock/db.ts 的持久化逻辑；
 *   2. 把每个函数体换成 fetch(`/api/...`)；
 *   3. 其余 UI 代码不动。
 *
 * 约定：读接口返回深拷贝，写接口抛 Error 表示业务校验失败（UI 用 message.error 呈现）。
 */

import dayjs from 'dayjs';
import type {
  InventoryTransaction,
  LogisticsEvent,
  LogisticsOrder,
  PageResult,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  ReceiptRecord,
  StockOverviewRow,
  StockTransfer,
  Supplier,
  SupplierMetrics,
  User,
  Warehouse,
} from '@/types';
import { delay, fail, getDb, mutate, nextSeq, resetDb } from '@/mock/db';
import { fmtDate, makeCode } from '@/utils/format';
import {
  buildStockOverview,
  inTransitQty,
  isLogisticsDelayed,
  isReceivable,
  remainingQty,
  suggestedPurchaseQty,
  supplierMetrics,
} from './rules';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function paginate<T>(list: T[], page = 1, pageSize = 10): PageResult<T> {
  const start = (page - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total: list.length };
}

function currentUser(): User {
  const db = getDb();
  return db.users.find((u) => u.id === db.currentUserId) ?? db.users[0];
}

/* ------------------------------------------------------------------ */
/* 登录 / 用户                                                          */
/* ------------------------------------------------------------------ */

export const authApi = {
  me: (): Promise<User> => delay(clone(currentUser()), 60),
  users: (): Promise<User[]> => delay(clone(getDb().users)),
  switchUser: async (userId: string): Promise<User> => {
    mutate((db) => {
      db.currentUserId = userId;
    });
    return delay(clone(currentUser()), 60);
  },
};

/* ------------------------------------------------------------------ */
/* 工作台                                                               */
/* ------------------------------------------------------------------ */

export interface DashboardTodo {
  pendingApproval: PurchaseOrder[];
  toReceive: PurchaseOrder[];
  logisticsException: LogisticsOrder[];
}

export interface DashboardAlert {
  lowStock: StockOverviewRow[];
  delayedLogistics: LogisticsOrder[];
  supplierRisk: Array<{ supplier: Supplier; metrics: SupplierMetrics }>;
}

export interface DashboardSummary {
  kpi: {
    /** 统计周期文案（真实后端按「本月」统计，mock 模式可为空） */
    periodLabel?: string;
    poCount: number;
    poAmount: number;
    /** 近 7 天采购金额对比前 7 天的环比；前 7 天为 0 时为 null */
    poAmountDelta: number | null;
    totalStockQty: number;
    lowStockCount: number;
    pendingApprovalCount: number;
    delayedLogisticsCount: number;
  };
  trend: Array<{ date: string; amount: number; count: number }>;
  todos: DashboardTodo;
  alerts: DashboardAlert;
  insights: string[];
}

export const dashboardApi = {
  trend: async (days: number, _startDate?: string, _endDate?: string) => {
    const summary = await dashboardApi.summary();
    return summary.trend.slice(-days);
  },

  charts: async () => {
    const db = getDb();
    const byCategory = new Map<string, { category: string; qty: number; amount: number }>();
    db.products.forEach((p) => {
      const stock = db.warehouseStock
        .filter((s) => s.productId === p.id)
        .reduce((sum, s) => sum + s.qty, 0);
      const row = byCategory.get(p.category) ?? { category: p.category, qty: 0, amount: 0 };
      row.qty += stock;
      row.amount += stock * (p.purchasePrice ?? 0);
      byCategory.set(p.category, row);
    });
    const statusMap = new Map<string, number>();
    db.logisticsOrders.forEach((lo) => {
      statusMap.set(lo.status, (statusMap.get(lo.status) ?? 0) + 1);
    });
    return {
      inventoryByCategory: Array.from(byCategory.values()),
      logisticsStatus: Array.from(statusMap.entries()).map(([status, count]) => ({
        status,
        label: status,
        count,
      })),
      supplierScores: db.suppliers.map((s) => ({
        supplierId: s.id,
        name: s.name,
        onTimeRate: null,
        completedOrders: 0,
        delayedOrders: 0,
        totalAmount: 0,
      })),
    };
  },

  summary: (): Promise<DashboardSummary> => {
    const db = getDb();
    const overview = buildStockOverview(db);
    const pendingApproval = db.purchaseOrders.filter((po) => po.status === 'pending');
    const toReceive = db.purchaseOrders.filter((po) => isReceivable(po) && remainingQty(po) > 0);
    const delayedLogistics = db.logisticsOrders.filter((lo) => isLogisticsDelayed(lo));
    const lowStock = overview.filter((o) => o.level !== 'normal');
    const supplierRisk = db.suppliers
      .filter((s) => s.status === 'active')
      .map((s) => ({ supplier: s, metrics: supplierMetrics(db, s.id) }))
      .filter((x) => x.metrics.onTimeRate != null && x.metrics.onTimeRate < 0.8)
      .sort((a, b) => (a.metrics.onTimeRate ?? 0) - (b.metrics.onTimeRate ?? 0));

    // 近 7 天采购趋势（按创建日期聚合）
    const trend = Array.from({ length: 7 }).map((_, idx) => {
      const date = dayjs().subtract(6 - idx, 'day');
      const orders = db.purchaseOrders.filter((po) => dayjs(po.createdAt).isSame(date, 'day'));
      return {
        date: date.format('MM-DD'),
        amount: Number(orders.reduce((s, po) => s + po.totalAmount, 0).toFixed(2)),
        count: orders.length,
      };
    });

    // 真实环比：近 7 天 vs 前 7 天（不编数字，前一周为 0 时返回 null）
    const sumWindow = (startOffset: number, endOffset: number) =>
      db.purchaseOrders
        .filter((po) => {
          const d = dayjs(po.createdAt);
          return d.isAfter(dayjs().subtract(startOffset, 'day')) && d.isBefore(dayjs().subtract(endOffset, 'day').endOf('day'));
        })
        .reduce((s, po) => s + po.totalAmount, 0);
    const last7 = trend.reduce((s, t) => s + t.amount, 0);
    const prev7 = sumWindow(13, 6);
    const poAmountDelta = prev7 > 0 ? Number(((last7 - prev7) / prev7).toFixed(4)) : null;

    const insights: string[] = [];
    const outOfStock = lowStock.find((o) => o.level === 'out');
    if (outOfStock) {
      insights.push(
        `${outOfStock.productName} 已缺货（0 / 安全库存 ${outOfStock.safetyStock} ${outOfStock.unit}），在途 ${outOfStock.inTransitQty} ${outOfStock.unit}，建议补货 ${outOfStock.suggestedQty} ${outOfStock.unit}。`,
      );
    }
    if (delayedLogistics.length > 0) {
      const worst = [...delayedLogistics].sort(
        (a, b) => dayjs(a.expectedArrival).valueOf() - dayjs(b.expectedArrival).valueOf(),
      )[0];
      const days = dayjs().diff(dayjs(worst.expectedArrival), 'day');
      insights.push(
        `物流单 ${worst.code} 已延误 ${days} 天（${worst.carrier}），关联采购单 ${worst.poCode}，建议评估库存影响并制定补救方案。`,
      );
    }
    if (supplierRisk.length > 0) {
      const worst = supplierRisk[0];
      insights.push(
        `${worst.supplier.name} 准时交付率 ${((worst.metrics.onTimeRate ?? 0) * 100).toFixed(0)}%，低于 80% 合格线，建议将其降为备选供应商。`,
      );
    }

    return delay({
      kpi: {
        poCount: db.purchaseOrders.length,
        poAmount: Number(db.purchaseOrders.reduce((s, po) => s + po.totalAmount, 0).toFixed(2)),
        poAmountDelta,
        totalStockQty: db.warehouseStock.reduce((s, r) => s + r.qty, 0),
        lowStockCount: lowStock.length,
        pendingApprovalCount: pendingApproval.length,
        delayedLogisticsCount: delayedLogistics.length,
      },
      trend,
      todos: {
        pendingApproval: clone(pendingApproval),
        toReceive: clone(toReceive),
        logisticsException: clone(delayedLogistics),
      },
      alerts: {
        lowStock: clone(lowStock),
        delayedLogistics: clone(delayedLogistics),
        supplierRisk: clone(supplierRisk),
      },
      insights,
    });
  },
};

/* ------------------------------------------------------------------ */
/* 供应商                                                               */
/* ------------------------------------------------------------------ */

export interface SupplierQuery {
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export const supplierApi = {
  list: (q: SupplierQuery = {}): Promise<PageResult<Supplier & { metrics: SupplierMetrics }>> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    let list = db.suppliers.filter((s) => {
      if (q.status && s.status !== q.status) return false;
      if (!kw) return true;
      return [s.name, s.contact, s.phone, s.code].some((f) => f.toLowerCase().includes(kw));
    });
    list = list.slice().sort((a, b) => a.code.localeCompare(b.code));
    const withMetrics = list.map((s) => ({ ...s, metrics: supplierMetrics(db, s.id) }));
    return delay(paginate(clone(withMetrics), q.page, q.pageSize));
  },

  /** 下拉选项：只返回合作中的供应商 */
  options: (): Promise<Array<{ label: string; value: string; categories?: string[] }>> => {
    const list = getDb()
      .suppliers.filter((s) => s.status === 'active')
      .sort((a, b) => a.code.localeCompare(b.code));
    return delay(
      list.map((s) => ({ label: `${s.name}（${s.code}）`, value: s.id, categories: s.categories })),
    );
  },

  get: (id: string): Promise<Supplier> => {
    const s = getDb().suppliers.find((x) => x.id === id);
    if (!s) return fail('供应商不存在');
    return delay(clone(s));
  },

  metrics: (id: string): Promise<SupplierMetrics> => {
    const db = getDb();
    if (!db.suppliers.some((s) => s.id === id)) return fail('供应商不存在');
    return delay(supplierMetrics(db, id));
  },

  orders: (id: string): Promise<PurchaseOrder[]> =>
    delay(clone(getDb().purchaseOrders.filter((po) => po.supplierId === id))),

  create: (payload: Omit<Supplier, 'id' | 'code' | 'createdAt'>): Promise<Supplier> => {
    const db = getDb();
    if (db.suppliers.some((s) => s.name === payload.name)) return fail('供应商名称已存在');
    const seq = nextSeq('supplier');
    const created: Supplier = {
      ...payload,
      id: `SUP-${seq}`,
      code: `SUP-${seq}`,
      createdAt: new Date().toISOString(),
    };
    mutate((d) => {
      d.suppliers.unshift(created);
    });
    return delay(clone(created), 240);
  },

  update: (id: string, payload: Partial<Supplier>): Promise<Supplier> => {
    const updated = mutate((db) => {
      const s = db.suppliers.find((x) => x.id === id);
      if (!s) throw new Error('供应商不存在');
      Object.assign(s, payload, { id: s.id, code: s.code });
      return clone(s);
    });
    return delay(updated, 240);
  },

  setStatus: (id: string, status: Supplier['status']): Promise<Supplier> => {
    const updated = mutate((db) => {
      const s = db.suppliers.find((x) => x.id === id);
      if (!s) throw new Error('供应商不存在');
      if (status === 'disabled') {
        const pending = db.purchaseOrders.some(
          (po) => po.supplierId === id && ['draft', 'pending', 'approved', 'partial'].includes(po.status),
        );
        if (pending) throw new Error('该供应商存在未完成的采购订单，不能停用');
      }
      s.status = status;
      return clone(s);
    });
    return delay(updated, 200);
  },
};

/* ------------------------------------------------------------------ */
/* 商品 / 仓库                                                          */
/* ------------------------------------------------------------------ */

export interface ProductQuery {
  keyword?: string;
  category?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export const productApi = {
  list: (q: ProductQuery = {}): Promise<PageResult<Product>> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    const list = db.products.filter((p) => {
      if (q.status && p.status !== q.status) return false;
      if (q.category && p.category !== q.category) return false;
      if (!kw) return true;
      return [p.name, p.code, p.spec].some((f) => f.toLowerCase().includes(kw));
    });
    return delay(paginate(clone(list), q.page, q.pageSize));
  },

  categories: (): Promise<string[]> => delay(Array.from(new Set(getDb().products.map((p) => p.category)))),

  create: (payload: Omit<Product, 'id' | 'code' | 'createdAt'>): Promise<Product> => {
    const seq = nextSeq('product');
    const created: Product = {
      ...payload,
      id: `PRD-${seq}`,
      code: `PRD-${seq}`,
      createdAt: new Date().toISOString(),
    };
    mutate((db) => {
      db.products.unshift(created);
      db.warehouses.forEach((w) => {
        db.warehouseStock.push({
          id: `${created.id}@${w.id}`,
          productId: created.id,
          warehouseId: w.id,
          qty: 0,
        });
      });
    });
    return delay(clone(created), 240);
  },

  update: (id: string, payload: Partial<Product>): Promise<Product> => {
    const updated = mutate((db) => {
      const p = db.products.find((x) => x.id === id);
      if (!p) throw new Error('商品不存在');
      Object.assign(p, payload, { id: p.id, code: p.code });
      return clone(p);
    });
    return delay(updated, 240);
  },

  setStatus: (id: string, status: Product['status']): Promise<Product> => {
    const updated = mutate((db) => {
      const p = db.products.find((x) => x.id === id);
      if (!p) throw new Error('商品不存在');
      p.status = status;
      return clone(p);
    });
    return delay(updated, 200);
  },
};

export const warehouseApi = {
  list: (): Promise<Warehouse[]> => delay(clone(getDb().warehouses)),

  get: (id: string): Promise<Warehouse> => {
    const w = getDb().warehouses.find((x) => x.id === id);
    if (!w) return fail('仓库不存在');
    return delay(clone(w));
  },

  create: (payload: Omit<Warehouse, 'id' | 'code' | 'createdAt'>): Promise<Warehouse> => {
    const seq = nextSeq('warehouse');
    const created: Warehouse = {
      ...payload,
      id: `WH-${seq}`,
      code: `WH-${seq}`,
      createdAt: new Date().toISOString(),
    };
    mutate((db) => {
      db.warehouses.push(created);
      db.products.forEach((p) => {
        db.warehouseStock.push({
          id: `${p.id}@${created.id}`,
          productId: p.id,
          warehouseId: created.id,
          qty: 0,
        });
      });
    });
    return delay(clone(created), 240);
  },

  update: (id: string, payload: Partial<Warehouse>): Promise<Warehouse> => {
    const updated = mutate((db) => {
      const w = db.warehouses.find((x) => x.id === id);
      if (!w) throw new Error('仓库不存在');
      Object.assign(w, payload, { id: w.id, code: w.code });
      return clone(w);
    });
    return delay(updated, 240);
  },

  setStatus: (id: string, status: Warehouse['status']): Promise<Warehouse> => {
    const updated = mutate((db) => {
      const w = db.warehouses.find((x) => x.id === id);
      if (!w) throw new Error('仓库不存在');
      if (status === 'disabled') {
        const hasStock = db.warehouseStock.some((s) => s.warehouseId === id && s.qty > 0);
        if (hasStock) throw new Error('该仓库仍有库存，不能停用');
      }
      w.status = status;
      return clone(w);
    });
    return delay(updated, 200);
  },
};

/* ------------------------------------------------------------------ */
/* 库存                                                                 */
/* ------------------------------------------------------------------ */

export const stockApi = {
  overview: (q: { keyword?: string; warehouseId?: string; level?: string } = {}): Promise<StockOverviewRow[]> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    let rows = buildStockOverview(db);
    if (kw) {
      rows = rows.filter((r) =>
        [r.productName, r.productCode, r.spec, r.category].some((f) => f.toLowerCase().includes(kw)),
      );
    }
    if (q.warehouseId) rows = rows.filter((r) => r.warehouses.some((w) => w.warehouseId === q.warehouseId));
    if (q.level) rows = rows.filter((r) => r.level === q.level);
    return delay(clone(rows));
  },

  alerts: (): Promise<StockOverviewRow[]> =>
    delay(clone(buildStockOverview(getDb()).filter((r) => r.level !== 'normal'))),

  /** 补货建议（对应工具 calculate_replenishment） */
  replenishment: (productId: string) => {
    const db = getDb();
    const product = db.products.find((p) => p.id === productId);
    if (!product) return fail('商品不存在');
    const current = db.warehouseStock
      .filter((s) => s.productId === productId)
      .reduce((s, r) => s + r.qty, 0);
    const transit = inTransitQty(db, productId);
    const qty = suggestedPurchaseQty(db, productId);
    return delay({
      product,
      current,
      safetyStock: product.safetyStock,
      inTransit: transit,
      suggestedQty: qty,
      formula: `max(0, ${product.safetyStock} − ${current} − ${transit}) = ${qty} ${product.unit}`,
      amount: Number((qty * product.purchasePrice).toFixed(2)),
    });
  },
};

/* ------------------------------------------------------------------ */
/* 采购订单                                                             */
/* ------------------------------------------------------------------ */

export interface PoQuery {
  keyword?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface PoCreatePayload {
  supplierId: string;
  expectedArrival: string;
  remark?: string;
  items: Array<{ productId: string; qty: number; price: number }>;
}

export interface ReceivePayload {
  warehouseId: string;
  items: Array<{ itemId: string; qty: number }>;
}

function buildItems(db: ReturnType<typeof getDb>, items: PoCreatePayload['items']): PurchaseOrderItem[] {
  return items.map((it, idx) => {
    const p = db.products.find((x) => x.id === it.productId);
    if (!p) throw new Error('商品不存在');
    return {
      id: `POI-${Date.now()}-${idx}`,
      productId: p.id,
      productName: p.name,
      spec: p.spec,
      unit: p.unit,
      qty: it.qty,
      receivedQty: 0,
      price: it.price,
      amount: Number((it.qty * it.price).toFixed(2)),
    };
  });
}

/** 审批通过后自动创建模拟物流单（已存在则跳过） */
function ensureLogisticsForPo(db: ReturnType<typeof getDb>, po: PurchaseOrder) {
  if (db.logisticsOrders.some((l) => l.poId === po.id)) return;
  const seq = nextSeq('log');
  const logId = `LOG-${seq}`;
  po.logisticsId = logId;
  db.logisticsOrders.unshift({
    id: logId,
    code: makeCode('LOG', seq),
    poId: po.id,
    poCode: po.code,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    carrier: '顺丰速运',
    trackingNo: `SF${Math.floor(1000000000 + Math.random() * 8999999999)}`,
    expectedArrival: po.expectedArrival,
    status: 'pending',
    delayed: false,
    events: [
      {
        id: `LE-${seq}`,
        time: new Date().toISOString(),
        node: '待发货',
        desc: '供应商已收到采购订单，等待发货',
        location: db.suppliers.find((s) => s.id === po.supplierId)?.address.slice(0, 2) ?? '供应商',
      },
    ],
  });
}

export const purchaseOrderApi = {
  list: (q: PoQuery = {}): Promise<PageResult<PurchaseOrder>> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    let list = db.purchaseOrders.filter((po) => {
      if (q.status && po.status !== q.status) return false;
      if (q.supplierId && po.supplierId !== q.supplierId) return false;
      if (!kw) return true;
      return (
        po.code.toLowerCase().includes(kw) ||
        po.supplierName.toLowerCase().includes(kw) ||
        po.items.some((i) => i.productName.toLowerCase().includes(kw))
      );
    });
    list = list.slice().sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
    return delay(paginate(clone(list), q.page, q.pageSize));
  },

  get: (id: string): Promise<PurchaseOrder> => {
    const po = getDb().purchaseOrders.find((x) => x.id === id);
    if (!po) return fail('采购订单不存在');
    return delay(clone(po));
  },

  create: (payload: PoCreatePayload): Promise<PurchaseOrder> => {
    const created = mutate((db) => {
      const supplier = db.suppliers.find((s) => s.id === payload.supplierId);
      if (!supplier) throw new Error('供应商不存在');
      if (supplier.status === 'disabled') throw new Error('供应商已停用，不能创建采购订单');
      if (!payload.items.length) throw new Error('请至少添加一个商品');
      const items = buildItems(db, payload.items);
      const seq = nextSeq('po');
      const me = currentUser();
      const po: PurchaseOrder = {
        id: makeCode('PO', seq),
        code: makeCode('PO', seq),
        supplierId: supplier.id,
        supplierName: supplier.name,
        items,
        totalAmount: Number(items.reduce((s, i) => s + i.amount, 0).toFixed(2)),
        createdBy: me.id,
        createdByName: me.name,
        createdAt: new Date().toISOString(),
        expectedArrival: payload.expectedArrival,
        status: 'draft',
        remark: payload.remark,
      };
      db.purchaseOrders.unshift(po);
      return clone(po);
    });
    return delay(created, 260);
  },

  update: (id: string, payload: PoCreatePayload): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (po.status !== 'draft') throw new Error('仅草稿状态可以编辑');
      const items = buildItems(db, payload.items);
      po.supplierId = payload.supplierId;
      po.supplierName = db.suppliers.find((s) => s.id === payload.supplierId)?.name ?? '';
      po.items = items;
      po.totalAmount = Number(items.reduce((s, i) => s + i.amount, 0).toFixed(2));
      po.expectedArrival = payload.expectedArrival;
      po.remark = payload.remark;
      return clone(po);
    });
    return delay(updated, 240);
  },

  submit: (id: string): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (po.status !== 'draft') throw new Error('仅草稿状态可以提交审批');
      if (!po.items.length) throw new Error('采购订单没有商品明细');
      const me = currentUser();
      if (me.role === 'admin') {
        // 管理者免审批：提交即通过
        po.status = 'approved';
        po.approverId = me.id;
        po.approverName = me.name;
        po.approvedAt = new Date().toISOString();
        ensureLogisticsForPo(db, po);
      } else {
        po.status = 'pending';
      }
      return clone(po);
    });
    return delay(updated, 220);
  },

  approve: (id: string): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (po.status !== 'pending') throw new Error('仅待审批状态可以审批');
      const me = currentUser();
      if (me.id === po.createdBy) throw new Error('创建人与审批人不能相同，请切换账号后再审批');
      po.status = 'approved';
      po.approverId = me.id;
      po.approverName = me.name;
      po.approvedAt = new Date().toISOString();

      // 审批通过后自动创建模拟物流单（真实系统由供应商发货后回传）
      ensureLogisticsForPo(db, po);
      return clone(po);
    });
    return delay(updated, 260);
  },

  reject: (id: string, reason: string): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (po.status !== 'pending') throw new Error('仅待审批状态可以驳回');
      if (!reason.trim()) throw new Error('请填写驳回原因');
      const me = currentUser();
      po.status = 'rejected';
      po.approverId = me.id;
      po.approverName = me.name;
      po.rejectReason = reason.trim();
      return clone(po);
    });
    return delay(updated, 220);
  },

  cancel: (id: string): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (!['draft', 'pending'].includes(po.status)) throw new Error('仅草稿或待审批状态可以取消');
      po.status = 'cancelled';
      return clone(po);
    });
    return delay(updated, 200);
  },

  /**
   * 登记收货
   * 核心规则：收货数量不能超过剩余未收数量；库存更新与流水写入在同一事务内完成。
   */
  receive: (id: string, payload: ReceivePayload): Promise<PurchaseOrder> => {
    const updated = mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id);
      if (!po) throw new Error('采购订单不存在');
      if (!isReceivable(po)) throw new Error('仅已审批或部分收货状态可以登记收货');
      const warehouse = db.warehouses.find((w) => w.id === payload.warehouseId);
      if (!warehouse) throw new Error('请选择入库仓库');
      if (warehouse.status === 'disabled') throw new Error('仓库已停用，不能入库');

      const valid = payload.items.filter((i) => i.qty > 0);
      if (!valid.length) throw new Error('请至少填写一项收货数量');

      // 先整体校验，全部通过后再写，避免出现“部分入账”的脏数据
      valid.forEach((line) => {
        const item = po.items.find((i) => i.id === line.itemId);
        if (!item) throw new Error('采购明细不存在');
        const remain = item.qty - item.receivedQty;
        if (line.qty > remain) {
          throw new Error(`${item.productName} 收货数量 ${line.qty} 超过剩余未收数量 ${remain}`);
        }
      });

      const me = currentUser();
      valid.forEach((line) => {
        const item = po.items.find((i) => i.id === line.itemId)!;
        item.receivedQty += line.qty;

        const stock = db.warehouseStock.find(
          (s) => s.productId === item.productId && s.warehouseId === warehouse.id,
        );
        const beforeQty = stock?.qty ?? 0;
        const afterQty = beforeQty + line.qty;
        if (stock) stock.qty = afterQty;
        else
          db.warehouseStock.push({
            id: `${item.productId}@${warehouse.id}`,
            productId: item.productId,
            warehouseId: warehouse.id,
            qty: afterQty,
          });

        db.inventoryTransactions.unshift({
          id: `IT-${nextSeq('it')}`,
          type: 'purchase_in',
          productId: item.productId,
          productName: item.productName,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          qty: line.qty,
          beforeQty,
          afterQty,
          refCode: po.code,
          operator: me.name,
          createdAt: new Date().toISOString(),
          remark: '采购收货入库',
        });
      });

      const allReceived = po.items.every((i) => i.receivedQty >= i.qty);
      po.status = allReceived ? 'completed' : 'partial';

      // 同步物流状态
      const lo = db.logisticsOrders.find((l) => l.poId === po.id);
      if (lo) {
        lo.delayed = false;
        lo.status = 'delivered';
        lo.events.push({
          id: `LE-${nextSeq('event')}`,
          time: new Date().toISOString(),
          node: allReceived ? '已签收' : '部分签收',
          desc: allReceived ? `货物已全部签收，入 ${warehouse.name}` : `部分收货，入 ${warehouse.name}`,
          location: warehouse.name,
        });
      }
      return clone(po);
    });
    return delay(updated, 320);
  },

  /** 收货记录：mock 模式下不单独存储收货单，返回空列表 */
  receipts: (_id: string): Promise<ReceiptRecord[]> => delay([]),
};

/* ------------------------------------------------------------------ */
/* 物流                                                                 */
/* ------------------------------------------------------------------ */

export interface LogisticsQuery {
  keyword?: string;
  status?: string;
  onlyDelayed?: boolean;
  page?: number;
  pageSize?: number;
}

export const logisticsApi = {
  list: (q: LogisticsQuery = {}): Promise<PageResult<LogisticsOrder>> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    let list = db.logisticsOrders.map((lo) => ({ ...lo, delayed: isLogisticsDelayed(lo) }));
    if (q.status) list = list.filter((lo) => lo.status === q.status);
    if (q.onlyDelayed) list = list.filter((lo) => lo.delayed);
    if (kw) {
      list = list.filter((lo) =>
        [lo.code, lo.trackingNo, lo.poCode, lo.supplierName, lo.carrier].some((f) =>
          f.toLowerCase().includes(kw),
        ),
      );
    }
    list.sort((a, b) => dayjs(b.expectedArrival).valueOf() - dayjs(a.expectedArrival).valueOf());
    return delay(paginate(clone(list), q.page, q.pageSize));
  },

  get: (id: string): Promise<LogisticsOrder> => {
    const lo = getDb().logisticsOrders.find((x) => x.id === id);
    if (!lo) return fail('物流单不存在');
    return delay({ ...clone(lo), delayed: isLogisticsDelayed(lo) });
  },

  /** 手动模拟物流节点推进（开发与演示用） */
  simulateUpdate: (id: string, node: { node: string; desc: string; location: string }): Promise<LogisticsOrder> => {
    const updated = mutate((db) => {
      const lo = db.logisticsOrders.find((x) => x.id === id);
      if (!lo) throw new Error('物流单不存在');
      const event: LogisticsEvent = {
        id: `LE-${nextSeq('event')}`,
        time: new Date().toISOString(),
        ...node,
      };
      lo.events.push(event);
      const statusMap: Record<string, LogisticsOrder['status']> = {
        已揽收: 'in_transit',
        运输中: 'in_transit',
        到达中转场: 'in_transit',
        派送中: 'arrived',
        已签收: 'delivered',
        异常: 'exception',
      };
      if (statusMap[node.node]) lo.status = statusMap[node.node];
      lo.delayed = isLogisticsDelayed(lo);
      return { ...clone(lo), delayed: lo.delayed };
    });
    return delay(updated, 260);
  },
};

/* ------------------------------------------------------------------ */
/* 调拨 / 库存流水                                                       */
/* ------------------------------------------------------------------ */

export interface TransferPayload {
  fromWarehouseId: string;
  toWarehouseId: string;
  productId: string;
  qty: number;
  remark?: string;
}

export const transferApi = {
  list: (): Promise<StockTransfer[]> =>
    delay(clone(getDb().stockTransfers.slice().sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()))),

  create: (payload: TransferPayload): Promise<StockTransfer> => {
    const created = mutate((db) => {
      const from = db.warehouses.find((w) => w.id === payload.fromWarehouseId);
      const to = db.warehouses.find((w) => w.id === payload.toWarehouseId);
      const product = db.products.find((p) => p.id === payload.productId);
      if (!from || !to) throw new Error('请选择调出与调入仓库');
      if (!product) throw new Error('请选择商品');
      if (from.id === to.id) throw new Error('调出仓库与调入仓库不能相同');
      if (payload.qty <= 0) throw new Error('调拨数量必须大于 0');

      const fromStock = db.warehouseStock.find(
        (s) => s.productId === product.id && s.warehouseId === from.id,
      );
      const available = fromStock?.qty ?? 0;
      if (available < payload.qty) {
        throw new Error(`${from.name} 库存不足，当前可用 ${available} ${product.unit}`);
      }

      const me = currentUser();
      const fromBefore = available;
      const fromAfter = available - payload.qty;
      fromStock!.qty = fromAfter;

      const toStock = db.warehouseStock.find((s) => s.productId === product.id && s.warehouseId === to.id);
      const toBefore = toStock?.qty ?? 0;
      const toAfter = toBefore + payload.qty;
      if (toStock) toStock.qty = toAfter;
      else
        db.warehouseStock.push({
          id: `${product.id}@${to.id}`,
          productId: product.id,
          warehouseId: to.id,
          qty: toAfter,
        });

      const seq = nextSeq('tr');
      const transfer: StockTransfer = {
        id: `TR-${seq}`,
        code: makeCode('TR', seq),
        fromWarehouseId: from.id,
        fromWarehouseName: from.name,
        toWarehouseId: to.id,
        toWarehouseName: to.name,
        productId: product.id,
        productName: product.name,
        qty: payload.qty,
        operator: me.name,
        createdAt: new Date().toISOString(),
        remark: payload.remark,
      };
      db.stockTransfers.unshift(transfer);

      const nowIso = new Date().toISOString();
      db.inventoryTransactions.unshift(
        {
          id: `IT-${nextSeq('it')}`,
          type: 'transfer_out',
          productId: product.id,
          productName: product.name,
          warehouseId: from.id,
          warehouseName: from.name,
          qty: -payload.qty,
          beforeQty: fromBefore,
          afterQty: fromAfter,
          refCode: transfer.code,
          operator: me.name,
          createdAt: nowIso,
          remark: '调拨出库',
        },
        {
          id: `IT-${nextSeq('it')}`,
          type: 'transfer_in',
          productId: product.id,
          productName: product.name,
          warehouseId: to.id,
          warehouseName: to.name,
          qty: payload.qty,
          beforeQty: toBefore,
          afterQty: toAfter,
          refCode: transfer.code,
          operator: me.name,
          createdAt: nowIso,
          remark: '调拨入库',
        },
      );
      return clone(transfer);
    });
    return delay(created, 320);
  },
};

export interface TxQuery {
  keyword?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

export const transactionApi = {
  list: (q: TxQuery = {}): Promise<PageResult<InventoryTransaction>> => {
    const db = getDb();
    const kw = (q.keyword ?? '').trim().toLowerCase();
    let list = db.inventoryTransactions.filter((t) => {
      if (q.type && t.type !== q.type) return false;
      if (!kw) return true;
      return [t.productName, t.refCode, t.warehouseName, t.operator].some((f) =>
        f.toLowerCase().includes(kw),
      );
    });
    list = list.slice().sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
    return delay(paginate(clone(list), q.page, q.pageSize));
  },
};

/* ------------------------------------------------------------------ */
/* 演示工具                                                             */
/* ------------------------------------------------------------------ */

export const demoApi = {
  reset: (): Promise<void> => {
    resetDb();
    return delay(undefined, 120);
  },
  /** 快捷查询：给 AI 工具层复用的数据快照 */
  snapshot: () => getDb(),
  todayLabel: () => fmtDate(new Date().toISOString()),
};

export { currentUser };

/* ------------------------------------------------------------------ */
/* 外部 Dify 助手：mock 模式不提供                                       */
/* ------------------------------------------------------------------ */

export const difyApi = {
  status: async () => ({
    enabled: false,
    configured: false,
    reachable: false,
    base_url: '',
    detail: 'mock 模式未接入外部助手',
  }),
  chatStream: async (_p: unknown, h: { onError: (m: string) => void; onDone: (c: string) => void }) => {
    h.onError('mock 模式下不可用外部 Dify 助手');
    h.onDone('');
  },
};
