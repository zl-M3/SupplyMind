/**
 * 真实后端适配层
 *
 * 后端：FastAPI（/api/v1），字段为 snake_case，金额/数量常以字符串返回。
 * 本文件负责「后端 DTO → 前端领域模型」的映射，让页面层完全不用改。
 *
 * 已接入：登录、工作台、供应商、采购单、物流、商品、仓库、库存预警、流水、调拨（只读）
 * 未接入的写操作会抛错并给出明确提示，避免"看起来成功其实没写库"。
 */

import dayjs from 'dayjs';
import type {
  InventoryTransaction,
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
import { http, setToken, clearToken, getToken } from './http';
import type { DashboardSummary, PoCreatePayload, ReceivePayload } from './mockApi';

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown, fallback = ''): string => (v === null || v === undefined ? fallback : String(v));

/** 未接入的写操作：接受任意参数，统一 reject，避免"点了看似成功其实没写库" */
const notWired =
  (what: string) =>
  (..._args: unknown[]): Promise<any> =>
    Promise.reject(new Error(`${what}尚未接入后端（当前前端为只读对接）`));

/** 后端分页 { items, total } → 前端 { list, total } */
function paged<T>(raw: any): PageResult<T> {
  const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
  const total = Array.isArray(raw) ? items.length : num(raw?.total, items.length);
  return { list: items as T[], total };
}

/* ------------------------------------------------------------------ */
/* 映射：主数据                                                        */
/* ------------------------------------------------------------------ */

function mapUser(r: any): User {
  return {
    id: str(r?.username),
    name: str(r?.display_name ?? r?.username),
    role: (String(r?.role ?? '').toLowerCase() === 'gm' ? 'admin' : 'buyer') as User['role'],
    department: str(r?.department, '供应链中心'),
  };
}

function mapSupplier(r: any): Supplier {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    contact: str(r.contact),
    phone: str(r.phone),
    categories: Array.isArray(r.categories) ? r.categories.map(String) : [],
    status: (r.status === 'disabled' ? 'disabled' : 'active') as Supplier['status'],
    address: str(r.address),
    createdAt: str(r.created_at),
    remark: str(r.remark) || undefined,
  };
}

function mapMetrics(r: any): SupplierMetrics {
  const enough = Boolean(r?.has_enough_sample);
  return {
    orderCount: num(r?.total_orders),
    completedCount: num(r?.sample_size),
    delayCount: num(r?.delayed_orders),
    onTimeRate: enough ? num(r?.on_time_rate, 0) : null,
  };
}

/**
 * 商品小类兜底：后端升级前（products 还没有 sub_category 字段）用编码映射，
 * 升级并重启后以数据库返回的 sub_category 为准。
 */
const SUB_CATEGORY_FALLBACK: Record<string, string> = {
  P001: '纸品清洁',
  P002: '纸品清洁',
  P006: '纸品清洁',
  P007: '纸品清洁',
  P003: '家居日用',
  P004: '家居日用',
  P005: '家居日用',
  P008: '粮油速食',
  P014: '粮油速食',
  P009: '蛋奶肉禽',
  P010: '蛋奶肉禽',
  P011: '蛋奶肉禽',
  P012: '蔬果酒水',
  P013: '蔬果酒水',
  P015: '纸张耗材',
  P017: '纸张耗材',
  P016: '文具用品',
  P018: '文具用品',
  P019: '文具用品',
};

function mapProduct(r: any): Product {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    category: str(r.category),
    subCategory: str(r.sub_category) || SUB_CATEGORY_FALLBACK[str(r.code)] || '',
    spec: str(r.spec),
    unit: str(r.unit),
    safetyStock: num(r.safety_stock),
    purchasePrice: num(r.purchase_price),
    status: (r.status === 'disabled' ? 'disabled' : 'active') as Product['status'],
    createdAt: str(r.created_at),
  };
}

function mapWarehouse(r: any): Warehouse {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    address: str(r.address),
    manager: str(r.manager),
    phone: str(r.phone),
    status: (r.status === 'disabled' ? 'disabled' : 'active') as Warehouse['status'],
    createdAt: str(r.created_at),
  };
}

/* ------------------------------------------------------------------ */
/* 映射：采购 / 物流                                                   */
/* ------------------------------------------------------------------ */

function mapPoItem(r: any): PurchaseOrderItem {
  const qty = num(r.qty);
  const price = num(r.price);
  return {
    id: str(r.id),
    productId: str(r.product_id),
    productName: str(r.product_name),
    spec: str(r.spec),
    unit: str(r.unit),
    qty,
    receivedQty: num(r.received_qty),
    price,
    amount: num(r.amount, qty * price),
  };
}

function mapPo(r: any): PurchaseOrder {
  return {
    id: str(r.id),
    code: str(r.code),
    supplierId: str(r.supplier_id),
    supplierName: str(r.supplier_name),
    items: (r.items ?? []).map(mapPoItem),
    totalAmount: num(r.total_amount),
    createdBy: str(r.created_by),
    createdByName: str(r.created_by_name ?? r.created_by),
    createdAt: str(r.created_at),
    expectedArrival: str(r.expected_arrival),
    status: str(r.status, 'draft') as PurchaseOrder['status'],
    approverId: r.approver ? str(r.approver) : undefined,
    approverName: r.approver_name ? str(r.approver_name) : undefined,
    approvedAt: r.approved_at ? str(r.approved_at) : undefined,
    rejectReason: r.reject_reason ? str(r.reject_reason) : undefined,
    remark: r.remark ? str(r.remark) : undefined,
    logisticsId: r.logistics_id ? str(r.logistics_id) : undefined,
  };
}

function mapLogistics(r: any): LogisticsOrder {
  return {
    id: str(r.id),
    code: str(r.code),
    poId: str(r.po_id),
    poCode: str(r.po_code),
    supplierId: str(r.supplier_id),
    supplierName: str(r.supplier_name),
    carrier: str(r.carrier),
    trackingNo: str(r.tracking_no),
    expectedArrival: str(r.expected_arrival),
    status: str(r.status, 'pending') as LogisticsOrder['status'],
    delayed: Boolean(r.is_delayed),
    remark: r.remark ? str(r.remark) : undefined,
    events: (r.events ?? []).map((e: any) => ({
      id: str(e.id),
      time: str(e.time),
      node: str(e.node),
      desc: str(e.description ?? e.desc),
      location: str(e.location),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 映射：库存                                                          */
/* ------------------------------------------------------------------ */

const STOCK_LEVEL: Record<string, StockOverviewRow['level']> = {
  out_of_stock: 'out',
  out: 'out',
  low_stock: 'low',
  low: 'low',
  normal: 'normal',
};

function mapAlertToRow(r: any): StockOverviewRow {
  const total = num(r.current_qty);
  const safety = num(r.safety_stock);
  return {
    productId: str(r.product_id),
    productCode: str(r.product_code),
    productName: str(r.product_name),
    spec: str(r.spec),
    unit: str(r.unit),
    category: str(r.category),
    safetyStock: safety,
    totalQty: total,
    level: STOCK_LEVEL[str(r.status)] ?? (total <= 0 ? 'out' : total < safety ? 'low' : 'normal'),
    gap: num(r.shortage, Math.max(0, safety - total)),
    inTransitQty: 0,
    suggestedQty: num(r.shortage, Math.max(0, safety - total)),
    warehouses: [],
  };
}

function mapTx(r: any): InventoryTransaction {
  return {
    id: str(r.id),
    type: str(r.type, 'purchase_in') as InventoryTransaction['type'],
    productId: str(r.product_id),
    productName: str(r.product_name),
    warehouseId: str(r.warehouse_id),
    warehouseName: str(r.warehouse_name),
    qty: num(r.qty),
    beforeQty: num(r.before_qty),
    afterQty: num(r.after_qty),
    refCode: str(r.ref_code),
    operator: str(r.operator),
    createdAt: str(r.created_at),
    remark: r.remark ? str(r.remark) : undefined,
  };
}

function mapTransfer(r: any): StockTransfer {
  return {
    id: str(r.id),
    code: str(r.code),
    fromWarehouseId: str(r.from_warehouse_id),
    fromWarehouseName: str(r.from_warehouse_name),
    toWarehouseId: str(r.to_warehouse_id),
    toWarehouseName: str(r.to_warehouse_name),
    productId: str(r.product_id),
    productName: str(r.product_name),
    qty: num(r.qty),
    operator: str(r.operator),
    createdAt: str(r.created_at),
    remark: r.remark ? str(r.remark) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* auth                                                               */
/* ------------------------------------------------------------------ */

export const authApi = {
  login: async (username: string, password: string): Promise<User> => {
    const res = await http.post<any>('/auth/login', { username, password });
    setToken(str(res?.access_token));
    return mapUser(res?.user);
  },

  loginWithToken: async (username: string, password: string) => {
    const res = await http.post<any>('/auth/login', { username, password });
    return { token: str(res?.access_token), user: mapUser(res?.user) };
  },

  me: async (): Promise<User> => {
    if (!getToken()) throw new Error('未登录');
    return mapUser(await http.get<any>('/auth/me'));
  },

  logout: async (): Promise<void> => {
    try {
      await http.post('/auth/logout');
    } catch {
      /* 忽略网络异常，本地照样清 token */
    }
    clearToken();
  },

  users: async (): Promise<User[]> => {
    const raw = await http.get<any>('/users');
    return (Array.isArray(raw) ? raw : (raw?.items ?? [])).map(mapUser);
  },

  switchUser: async (): Promise<User> => authApi.me(),
};

/* ------------------------------------------------------------------ */
/* 工作台                                                              */
/* ------------------------------------------------------------------ */

export interface DashboardCharts {
  inventoryByCategory: Array<{ category: string; qty: number; amount: number }>;
  logisticsStatus: Array<{ status: string; label: string; count: number }>;
  supplierScores: Array<{
    supplierId: string;
    name: string;
    onTimeRate: number | null;
    completedOrders: number;
    delayedOrders: number;
    totalAmount: number;
  }>;
}

export const dashboardApi = {
  trend: async (
    days: number,
    startDate?: string,
    endDate?: string,
  ): Promise<Array<{ date: string; amount: number; count: number }>> => {
    const raw = await http.get<any>('/dashboard/trend', {
      days,
      start_date: startDate,
      end_date: endDate,
    });
    return (raw?.points ?? []).map((p: any) => ({
      date: dayjs(str(p.date)).format('MM-DD'),
      amount: num(p.amount),
      count: num(p.count),
    }));
  },

  charts: async (): Promise<DashboardCharts> => {
    const raw = await http.get<any>('/dashboard/charts');
    return {
      inventoryByCategory: (raw?.inventory_by_category ?? []).map((x: any) => ({
        category: str(x.category),
        qty: num(x.qty),
        amount: num(x.amount),
      })),
      logisticsStatus: (raw?.logistics_status ?? []).map((x: any) => ({
        status: str(x.status),
        label: str(x.label),
        count: num(x.count),
      })),
      supplierScores: (raw?.supplier_scores ?? []).map((x: any) => ({
        supplierId: str(x.supplier_id),
        name: str(x.name),
        onTimeRate: x.on_time_rate === null || x.on_time_rate === undefined ? null : num(x.on_time_rate),
        completedOrders: num(x.completed_orders),
        delayedOrders: num(x.delayed_orders),
        totalAmount: num(x.total_purchase_amount),
      })),
    };
  },

  summary: async (): Promise<DashboardSummary> => {
    const [overview, pending, toReceive, delayed, alertsRaw] = await Promise.all([
      http.get<any>('/dashboard/overview'),
      http.get<any>('/purchase-orders', { status: 'pending', page: 1, page_size: 5 }),
      http.get<any>('/purchase-orders', { status: 'approved', page: 1, page_size: 5 }),
      http.get<any>('/logistics', { only_delayed: true, page: 1, page_size: 5 }),
      // 工作台 overview 里的 alerts 只有文本，数量要单独取库存预警接口
      http.get<any>('/inventory/alerts', { page: 1, page_size: 5 }).catch(() => ({ items: [] })),
    ]);

    const kpiRaw = overview?.kpi ?? {};
    const points: any[] = overview?.trend?.points ?? [];
    const insightsRaw: any[] = overview?.ai_insights ?? [];
    const lowStock: StockOverviewRow[] = paged<any>(alertsRaw).list.map(mapAlertToRow);

    return {
      kpi: {
        periodLabel: str(kpiRaw.period_label) || undefined,
        poCount: num(kpiRaw.po_count),
        poAmount: num(kpiRaw.po_amount),
        poAmountDelta: null,
        totalStockQty: num(kpiRaw.total_qty),
        lowStockCount: num(kpiRaw.low_stock_count),
        pendingApprovalCount: num(kpiRaw.pending_count),
        delayedLogisticsCount: num(kpiRaw.delayed_count),
      },
      trend: points.map((p) => ({
        date: dayjs(str(p.date)).format('MM-DD'),
        amount: num(p.amount),
        count: num(p.count),
      })),
      todos: {
        pendingApproval: paged<PurchaseOrder>(pending).list.map(mapPo),
        toReceive: paged<PurchaseOrder>(toReceive).list.map(mapPo),
        logisticsException: paged<LogisticsOrder>(delayed).list.map(mapLogistics),
      },
      alerts: {
        lowStock,
        delayedLogistics: paged<LogisticsOrder>(delayed).list.map(mapLogistics),
        supplierRisk: [],
      },
      insights: insightsRaw.map((i) => `${str(i.title)}：${str(i.description)}`),
    } as DashboardSummary;
  },
};

/* ------------------------------------------------------------------ */
/* 供应商                                                              */
/* ------------------------------------------------------------------ */

/** 供应商下拉选项（后端 /suppliers/options，只返回合作中的供应商） */
export interface SupplierOption {
  label: string;
  value: string;
  categories?: string[];
}

export const supplierApi = {
  list: async (q: any = {}): Promise<PageResult<Supplier & { metrics: SupplierMetrics }>> => {
    const raw = await http.get<any>('/suppliers', {
      keyword: q.keyword,
      status: q.status,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 10,
    });
    const page = paged<any>(raw);
    // 列表页要显示准时率，逐条取统计（数据量小，可接受；量大时改批量接口）
    const withMetrics = await Promise.all(
      page.list.map(async (row) => {
        try {
          const stat = await http.get<any>(`/suppliers/${row.id}/statistics`);
          return { ...mapSupplier(row), metrics: mapMetrics(stat) };
        } catch {
          return { ...mapSupplier(row), metrics: { orderCount: 0, completedCount: 0, delayCount: 0, onTimeRate: null } };
        }
      }),
    );
    return { list: withMetrics, total: page.total };
  },

  /** 下拉选项：采购订单里选供应商时使用（比列表接口轻，且只含合作中） */
  options: async (): Promise<SupplierOption[]> => {
    const raw = await http.get<any>('/suppliers/options');
    const list: any[] = Array.isArray(raw) ? raw : (raw?.items ?? []);
    return list.map((o) => {
      const code = str(o.code);
      const name = str(o.name ?? o.label);
      return {
        label: code ? `${name}（${code}）` : name,
        value: str(o.id ?? o.value),
        categories: Array.isArray(o.categories) ? o.categories.map(String) : undefined,
      };
    });
  },

  get: async (id: string): Promise<Supplier> => mapSupplier(await http.get<any>(`/suppliers/${id}`)),

  metrics: async (id: string): Promise<SupplierMetrics> =>
    mapMetrics(await http.get<any>(`/suppliers/${id}/statistics`)),

  orders: async (id: string): Promise<PurchaseOrder[]> => {
    const raw = await http.get<any>('/purchase-orders', { supplier_id: id, page: 1, page_size: 100 });
    return paged<any>(raw).list.map(mapPo);
  },

  create: async (
    payload: Omit<Supplier, 'id' | 'code' | 'createdAt'> & Partial<Pick<Supplier, 'code'>>,
  ): Promise<Supplier> => {
    const raw = await http.post<any>('/suppliers', {
      code: payload.code || undefined, // 留空由后端按 SUP001 规则生成
      name: payload.name,
      contact: payload.contact,
      phone: payload.phone,
      categories: payload.categories ?? [],
      address: payload.address,
      status: payload.status ?? 'active',
      remark: payload.remark,
    });
    return mapSupplier(raw);
  },

  update: async (id: string, payload: Partial<Supplier>): Promise<Supplier> => {
    const raw = await http.put<any>(`/suppliers/${id}`, {
      name: payload.name,
      contact: payload.contact,
      phone: payload.phone,
      categories: payload.categories,
      address: payload.address,
      status: payload.status,
      remark: payload.remark,
    });
    return mapSupplier(raw);
  },

  setStatus: async (id: string, status: Supplier['status']): Promise<Supplier> =>
    mapSupplier(
      await http.patch<any>(`/suppliers/${id}/status`, undefined, { status }),
    ),
};

/* ------------------------------------------------------------------ */
/* 商品 / 仓库                                                         */
/* ------------------------------------------------------------------ */

export const productApi = {
  list: async (q: any = {}): Promise<PageResult<Product>> => {
    const raw = await http.get<any>('/products', {
      keyword: q.keyword,
      category: q.category,
      status: q.status,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 10,
    });
    const page = paged<any>(raw);
    return { list: page.list.map(mapProduct), total: page.total };
  },

  categories: async (): Promise<string[]> => {
    const raw = await http.get<any>('/products', { page: 1, page_size: 200 });
    return Array.from(new Set(paged<any>(raw).list.map((p) => str(p.category)).filter(Boolean)));
  },

  create: notWired('新建商品'),
  update: notWired('编辑商品'),
  setStatus: notWired('启停用商品'),
};

export const warehouseApi = {
  list: async (): Promise<Warehouse[]> => {
    const raw = await http.get<any>('/warehouses');
    return (Array.isArray(raw) ? raw : (raw?.items ?? [])).map(mapWarehouse);
  },
  get: async (id: string): Promise<Warehouse> => mapWarehouse(await http.get<any>(`/warehouses/${id}`)),
  create: notWired('新建仓库'),
  update: notWired('编辑仓库'),
  setStatus: notWired('启停用仓库'),
};

/* ------------------------------------------------------------------ */
/* 库存                                                                */
/* ------------------------------------------------------------------ */

export const stockApi = {
  overview: async (q: any = {}): Promise<StockOverviewRow[]> => {
    const raw = await http.get<any>('/products', {
      keyword: q.keyword,
      category: q.category,
      page: 1,
      page_size: 200,
    });
    const rows: StockOverviewRow[] = paged<any>(raw).list.map((p) => {
      const total = num(p.total_qty);
      const safety = num(p.safety_stock);
      const level = STOCK_LEVEL[str(p.stock_status)] ?? (total <= 0 ? 'out' : total < safety ? 'low' : 'normal');
      return {
        productId: str(p.id),
        productCode: str(p.code),
        productName: str(p.name),
        spec: str(p.spec),
        unit: str(p.unit),
        category: str(p.category),
        safetyStock: safety,
        totalQty: total,
        level,
        gap: Math.max(0, safety - total),
        inTransitQty: 0,
        suggestedQty: Math.max(0, safety - total),
        warehouses: [],
      };
    });
    const filtered = q.level ? rows.filter((r) => r.level === q.level) : rows;
    return q.warehouseId ? filtered : filtered;
  },

  alerts: async (): Promise<StockOverviewRow[]> => {
    const raw = await http.get<any>('/inventory/alerts', { page: 1, page_size: 100 });
    return paged<any>(raw).list.map(mapAlertToRow);
  },

  replenishment: async (productId: string) => {
    const raw = await http.get<any>(`/inventory/replenishment/${productId}`);
    const product = mapProduct(await http.get<any>(`/products/${productId}`));
    return {
      product,
      current: num(raw?.current_qty ?? raw?.available_qty),
      safetyStock: num(raw?.safety_stock, product.safetyStock),
      inTransit: num(raw?.in_transit_qty ?? raw?.pending_qty),
      suggestedQty: num(raw?.suggested_qty ?? raw?.suggest_qty),
      formula: str(raw?.formula, ''),
      amount: num(raw?.amount),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 采购订单                                                            */
/* ------------------------------------------------------------------ */

/** 前端采购单载荷 → 后端 snake_case 载荷 */
function toPoBody(p: PoCreatePayload) {
  return {
    supplier_id: p.supplierId,
    expected_arrival: dayjs(p.expectedArrival).format('YYYY-MM-DD'),
    remark: p.remark,
    items: (p.items ?? []).map((item) => ({
      product_id: item.productId,
      qty: Number(item.qty),
      price: Number(item.price),
    })),
  };
}

function mapReceipt(r: any): ReceiptRecord {
  return {
    id: str(r.id),
    code: str(r.code),
    warehouseName: str(r.warehouse_name),
    receivedBy: str(r.received_by),
    receivedAt: str(r.received_at),
    remark: r.remark ? str(r.remark) : undefined,
    items: (r.items ?? []).map((line: any) => ({
      id: num(line.id),
      poItemId: str(line.po_item_id),
      productName: str(line.product_name),
      qty: num(line.qty),
    })),
  };
}

export const purchaseOrderApi = {
  list: async (q: any = {}): Promise<PageResult<PurchaseOrder>> => {
    const raw = await http.get<any>('/purchase-orders', {
      keyword: q.keyword,
      status: q.status,
      supplier_id: q.supplierId,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 10,
    });
    const page = paged<any>(raw);
    return { list: page.list.map(mapPo), total: page.total };
  },

  get: async (id: string): Promise<PurchaseOrder> => mapPo(await http.get<any>(`/purchase-orders/${id}`)),

  create: async (payload: PoCreatePayload): Promise<PurchaseOrder> =>
    mapPo(await http.post<any>('/purchase-orders', toPoBody(payload))),

  update: async (id: string, payload: PoCreatePayload): Promise<PurchaseOrder> =>
    mapPo(await http.put<any>(`/purchase-orders/${id}`, toPoBody(payload))),

  /** 提交：采购员 → 待审批；管理员 → 后端直接通过（免审批） */
  submit: async (id: string): Promise<PurchaseOrder> =>
    mapPo(await http.post<any>(`/purchase-orders/${id}/submit`)),

  approve: async (id: string): Promise<PurchaseOrder> =>
    mapPo(await http.post<any>(`/purchase-orders/${id}/approve`)),

  reject: async (id: string, reason: string): Promise<PurchaseOrder> =>
    mapPo(await http.post<any>(`/purchase-orders/${id}/reject`, { reason })),

  cancel: async (id: string, reason?: string): Promise<PurchaseOrder> =>
    mapPo(await http.post<any>(`/purchase-orders/${id}/cancel`, reason ? { reason } : {})),

  /** 登记收货：写收货单 + 增库存 + 写库存流水（后端同一事务） */
  receive: async (id: string, payload: ReceivePayload): Promise<PurchaseOrder> => {
    await http.post<any>(`/purchase-orders/${id}/receive`, {
      warehouse_id: payload.warehouseId,
      items: (payload.items ?? [])
        .filter((line) => Number(line.qty) > 0)
        .map((line) => ({ po_item_id: line.itemId, qty: Number(line.qty) })),
    });
    return mapPo(await http.get<any>(`/purchase-orders/${id}`));
  },

  /** 收货记录（含每次收货的仓库、收货人与数量） */
  receipts: async (id: string): Promise<ReceiptRecord[]> => {
    const raw = await http.get<any>(`/purchase-orders/${id}/receipts`);
    const list: any[] = Array.isArray(raw) ? raw : (raw?.items ?? []);
    return list.map(mapReceipt);
  },
};

/* ------------------------------------------------------------------ */
/* 物流                                                                */
/* ------------------------------------------------------------------ */

export const logisticsApi = {
  list: async (q: any = {}): Promise<PageResult<LogisticsOrder>> => {
    const raw = await http.get<any>('/logistics', {
      keyword: q.keyword,
      status: q.status,
      only_delayed: q.onlyDelayed || undefined,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 10,
    });
    const page = paged<any>(raw);
    return { list: page.list.map(mapLogistics), total: page.total };
  },

  get: async (id: string): Promise<LogisticsOrder> =>
    mapLogistics(await http.get<any>(`/logistics/${id}`)),

  simulateUpdate: async (id: string, node: any): Promise<LogisticsOrder> => {
    await http.post(`/logistics/${id}/events`, {
      node: node.node,
      description: node.desc,
      location: node.location,
    });
    return logisticsApi.get(id);
  },
};

/* ------------------------------------------------------------------ */
/* 调拨 / 流水                                                         */
/* ------------------------------------------------------------------ */

export const transferApi = {
  list: async (): Promise<StockTransfer[]> => {
    const raw = await http.get<any>('/stock-transfers', { page: 1, page_size: 100 });
    return paged<any>(raw).list.map(mapTransfer);
  },
  create: notWired('新建调拨'),
};

export const transactionApi = {
  list: async (q: any = {}): Promise<PageResult<InventoryTransaction>> => {
    const raw = await http.get<any>('/inventory/transactions', {
      keyword: q.keyword,
      type: q.type,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 10,
    });
    const page = paged<any>(raw);
    return { list: page.list.map(mapTx), total: page.total };
  },
};

/* ------------------------------------------------------------------ */
/* 演示工具（真实模式下不提供重置）                                      */
/* ------------------------------------------------------------------ */

export const demoApi = {
  reset: (): Promise<void> => Promise.reject(new Error('真实后端模式下不支持重置演示数据')),
  snapshot: () => ({}) as never,
  todayLabel: () => dayjs().format('YYYY-MM-DD'),
};

export const currentUser = () => ({
  id: 'gm',
  name: '张伟',
  role: 'admin' as const,
  department: '供应链中心',
});



/* ------------------------------------------------------------------ */
/* 外部 Dify 助手（经后端代理，密钥不出现在前端）                          */
/* ------------------------------------------------------------------ */

export interface DifyStatus {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  base_url: string;
  detail: string;
}

export interface DifyChatResult {
  answer: string;
  conversation_id: string;
  message_id: string;
}

export interface DifyStreamHandlers {
  onDelta: (text: string) => void;
  onDone: (conversationId: string) => void;
  onError: (message: string) => void;
}

export interface DifyAttachment {
  id: string;
  name: string;
  chars: number;
  truncated: boolean;
  preview: string;
}

export const difyApi = {
  status: (force = false): Promise<DifyStatus> =>
    http.get<DifyStatus>('/ai/dify/status', force ? { force: true } : undefined),

  /** 上传资料（PDF / Word / Excel / TXT），后端抽文本后随问题一起发给 Dify */
  upload: async (file: File): Promise<DifyAttachment> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v1/ai/dify/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    });
    if (!res.ok) {
      let msg = `上传失败（HTTP ${res.status}）`;
      try {
        const data = await res.json();
        msg = data?.message ?? data?.code ?? msg;
      } catch {
        /* 忽略 */
      }
      throw new Error(msg);
    }
    return (await res.json()) as DifyAttachment;
  },

  /**
   * 流式对话：后端代理 Dify 的 SSE，逐段回调。
   * Dify 的 Agent 类型应用不支持 blocking 模式，所以这里只提供流式。
   */
  chatStream: async (
    payload: { query: string; conversationId?: string; context?: string; attachmentIds?: string[] },
    handlers: DifyStreamHandlers,
  ): Promise<void> => {
    const res = await fetch('/api/v1/ai/dify/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        query: payload.query,
        conversation_id: payload.conversationId ?? '',
        context: payload.context ?? '',
        attachment_ids: payload.attachmentIds ?? [],
      }),
    });

    if (!res.ok || !res.body) {
      let msg = `助手接口异常（HTTP ${res.status}）`;
      try {
        const data = await res.json();
        msg = data?.message ?? data?.code ?? msg;
      } catch {
        /* 忽略 */
      }
      handlers.onError(msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.error) {
            handlers.onError(String(evt.error));
            finished = true;
            break;
          }
          if (evt.delta) handlers.onDelta(String(evt.delta));
          if (evt.done) {
            handlers.onDone(String(evt.conversation_id ?? ''));
            finished = true;
            break;
          }
        } catch {
          /* 半包，等下一次 */
        }
      }
    }
  },
};
