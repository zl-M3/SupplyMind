import type {
  AgentTask,
  AiConversation,
  AiReport,
  InventoryTransaction,
  LogisticsEvent,
  LogisticsOrder,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  StockTransfer,
  Supplier,
  SupplierMetrics,
  User,
  Warehouse,
  WarehouseStock,
} from '@/types';
import { daysAgo, daysLater, hoursAgo, makeCode } from '@/utils/format';

/* ------------------------------------------------------------------ */
/* 用户                                                                */
/* ------------------------------------------------------------------ */

export const USERS: User[] = [
  { id: 'U-001', name: '张伟', role: 'admin', department: '供应链中心' },
  { id: 'U-002', name: '李娜', role: 'buyer', department: '采购部' },
  { id: 'U-003', name: '王强', role: 'buyer', department: '采购部' },
];

export const ROLE_LABEL: Record<User['role'], string> = {
  admin: '管理者',
  buyer: '采购员',
};

/* ------------------------------------------------------------------ */
/* 仓库                                                                */
/* ------------------------------------------------------------------ */

export const WAREHOUSES: Warehouse[] = [
  {
    id: 'WH-01',
    code: 'WH-01',
    name: '华东主仓',
    address: '上海市青浦区华新镇物流大道 88 号',
    manager: '张伟',
    phone: '13800000001',
    status: 'active',
    createdAt: daysAgo(420),
  },
  {
    id: 'WH-02',
    code: 'WH-02',
    name: '华南仓',
    address: '广州市白云区太和镇兴丰路 12 号',
    manager: '陈明',
    phone: '13800000002',
    status: 'active',
    createdAt: daysAgo(360),
  },
  {
    id: 'WH-03',
    code: 'WH-03',
    name: '华北仓',
    address: '北京市大兴区亦庄经济开发区科创五街 9 号',
    manager: '刘芳',
    phone: '13800000003',
    status: 'active',
    createdAt: daysAgo(280),
  },
];

/* ------------------------------------------------------------------ */
/* 供应商                                                              */
/* ------------------------------------------------------------------ */

export const SUPPLIERS: Supplier[] = [
  {
    id: 'SUP-001',
    code: 'SUP-001',
    name: '杭州汇通包装材料有限公司',
    contact: '张建国',
    phone: '13900000011',
    categories: ['包装材料'],
    status: 'active',
    address: '浙江省杭州市余杭区仓前街道工业园 3 号',
    createdAt: daysAgo(400),
    remark: '主供纸箱与缓冲材料，账期 30 天',
  },
  {
    id: 'SUP-002',
    code: 'SUP-002',
    name: '苏州恒信办公用品有限公司',
    contact: '陈明',
    phone: '13900000012',
    categories: ['办公耗材'],
    status: 'active',
    address: '江苏省苏州市吴中区木渎镇金枫路 66 号',
    createdAt: daysAgo(380),
    remark: '纸张与文具类，周结',
  },
  {
    id: 'SUP-003',
    code: 'SUP-003',
    name: '上海鼎盛劳保用品厂',
    contact: '刘芳',
    phone: '13900000013',
    categories: ['劳保用品'],
    status: 'active',
    address: '上海市松江区九亭镇涞寅路 21 号',
    createdAt: daysAgo(300),
    remark: '手套类为主，近期交付不稳定',
  },
  {
    id: 'SUP-004',
    code: 'SUP-004',
    name: '宁波华工化工有限公司',
    contact: '赵磊',
    phone: '13900000014',
    categories: ['化工原料'],
    status: 'active',
    address: '浙江省宁波市北仑区新碶街道化工路 8 号',
    createdAt: daysAgo(150),
    remark: '危化品需资质审核',
  },
  {
    id: 'SUP-005',
    code: 'SUP-005',
    name: '广州联创包装科技有限公司',
    contact: '林晓',
    phone: '13900000015',
    categories: ['包装材料'],
    status: 'active',
    address: '广东省广州市番禺区石碁镇工业大道 5 号',
    createdAt: daysAgo(260),
    remark: '珍珠棉、气泡膜',
  },
  {
    id: 'SUP-006',
    code: 'SUP-006',
    name: '天津远洋日用品有限公司',
    contact: '孙浩',
    phone: '13900000016',
    categories: ['日用百货'],
    status: 'disabled',
    address: '天津市西青区辛口镇工业区 18 号',
    createdAt: daysAgo(500),
    remark: '已停用：交付屡次延期',
  },
  {
    id: 'SUP-007',
    code: 'SUP-007',
    name: '无锡金诚纸制品厂',
    contact: '周敏',
    phone: '13900000017',
    categories: ['包装材料'],
    status: 'active',
    address: '江苏省无锡市锡山区东亭镇春晖路 30 号',
    createdAt: daysAgo(220),
    remark: '纸箱备选供应商，准时率高但单价略高',
  },
];

/* ------------------------------------------------------------------ */
/* 商品                                                                */
/* ------------------------------------------------------------------ */

export const PRODUCTS: Product[] = [
  { id: 'PRD-001', code: 'PRD-001', name: '五层瓦楞纸箱', category: '包装材料', subCategory: '纸箱', spec: '600×400×300mm', unit: '个', safetyStock: 800, purchasePrice: 4.2, status: 'active', createdAt: daysAgo(400) },
  { id: 'PRD-002', code: 'PRD-002', name: '气泡膜卷', category: '包装材料', subCategory: '缓冲材料', spec: '50cm×100m', unit: '卷', safetyStock: 200, purchasePrice: 28.5, status: 'active', createdAt: daysAgo(390) },
  { id: 'PRD-003', code: 'PRD-003', name: '食品级 PE 保鲜袋', category: '包装材料', subCategory: '袋类', spec: '30×40cm 100只/包', unit: '包', safetyStock: 500, purchasePrice: 6.8, status: 'active', createdAt: daysAgo(360) },
  { id: 'PRD-004', code: 'PRD-004', name: '不锈钢保温杯', category: '日用百货', subCategory: '杯具', spec: '500ml', unit: '个', safetyStock: 120, purchasePrice: 45, status: 'active', createdAt: daysAgo(340) },
  { id: 'PRD-005', code: 'PRD-005', name: 'A4 复印纸', category: '办公耗材', subCategory: '纸张', spec: '70g 500张/包', unit: '包', safetyStock: 300, purchasePrice: 22.5, status: 'active', createdAt: daysAgo(330) },
  { id: 'PRD-006', code: 'PRD-006', name: '中性笔', category: '办公耗材', subCategory: '书写工具', spec: '0.5mm 黑色', unit: '支', safetyStock: 2000, purchasePrice: 1.2, status: 'active', createdAt: daysAgo(320) },
  { id: 'PRD-007', code: 'PRD-007', name: '工业酒精', category: '化工原料', subCategory: '清洁化工', spec: '5L/桶', unit: '桶', safetyStock: 80, purchasePrice: 38, status: 'active', createdAt: daysAgo(300) },
  { id: 'PRD-008', code: 'PRD-008', name: '一次性丁腈手套', category: '劳保用品', subCategory: '防护手套', spec: 'M 码 100只/盒', unit: '盒', safetyStock: 150, purchasePrice: 32, status: 'active', createdAt: daysAgo(290) },
  { id: 'PRD-009', code: 'PRD-009', name: '无纺布购物袋', category: '包装材料', subCategory: '袋类', spec: '35×40cm', unit: '个', safetyStock: 1000, purchasePrice: 1.8, status: 'active', createdAt: daysAgo(280) },
  { id: 'PRD-010', code: 'PRD-010', name: '封箱胶带', category: '包装材料', subCategory: '胶带', spec: '60mm×100m', unit: '卷', safetyStock: 600, purchasePrice: 5.5, status: 'active', createdAt: daysAgo(270) },
  { id: 'PRD-011', code: 'PRD-011', name: '珍珠棉填充块', category: '包装材料', subCategory: '缓冲材料', spec: '20×10×5cm', unit: '包', safetyStock: 300, purchasePrice: 12, status: 'active', createdAt: daysAgo(250) },
  { id: 'PRD-012', code: 'PRD-012', name: '干燥剂', category: '包装材料', subCategory: '其他包装', spec: '5g×500包', unit: '包', safetyStock: 200, purchasePrice: 18.5, status: 'active', createdAt: daysAgo(240) },
];

export const PRODUCT_MAP = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
export const WAREHOUSE_MAP = Object.fromEntries(WAREHOUSES.map((w) => [w.id, w]));
export const SUPPLIER_MAP = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/* 库存（仓库 × 商品）                                                  */
/* ------------------------------------------------------------------ */

const STOCK_SEED: Record<string, [number, number, number]> = {
  // productId: [WH-01, WH-02, WH-03]
  'PRD-001': [320, 260, 90],
  'PRD-002': [40, 30, 0],
  'PRD-003': [0, 0, 0],
  'PRD-004': [60, 30, 15],
  'PRD-005': [180, 120, 60],
  'PRD-006': [900, 700, 500],
  'PRD-007': [20, 15, 10],
  'PRD-008': [160, 90, 40],
  'PRD-009': [0, 400, 200],
  'PRD-010': [300, 200, 150],
  'PRD-011': [120, 100, 90],
  'PRD-012': [80, 70, 60],
};

export const WAREHOUSE_STOCK: WarehouseStock[] = Object.entries(STOCK_SEED).flatMap(
  ([productId, qtys]) =>
    qtys.map((qty, idx) => ({
      id: `${productId}@${WAREHOUSES[idx].id}`,
      productId,
      warehouseId: WAREHOUSES[idx].id,
      qty,
    })),
);

/* ------------------------------------------------------------------ */
/* 采购订单                                                            */
/* ------------------------------------------------------------------ */

let itemSeq = 0;
function mkItem(productId: string, qty: number, price: number, receivedQty = 0): PurchaseOrderItem {
  const p = PRODUCT_MAP[productId];
  itemSeq += 1;
  return {
    id: `POI-${String(itemSeq).padStart(4, '0')}`,
    productId,
    productName: p.name,
    spec: p.spec,
    unit: p.unit,
    qty,
    receivedQty,
    price,
    amount: Number((qty * price).toFixed(2)),
  };
}

function mkOrder(params: {
  seq: number;
  supplierId: string;
  items: PurchaseOrderItem[];
  status: PurchaseOrder['status'];
  createdAt: string;
  expectedArrival: string;
  createdBy?: string;
  createdByName?: string;
  approverName?: string;
  approvedAt?: string;
  rejectReason?: string;
  remark?: string;
}): PurchaseOrder {
  const supplier = SUPPLIER_MAP[params.supplierId];
  return {
    id: makeCode('PO', params.seq),
    code: makeCode('PO', params.seq),
    supplierId: params.supplierId,
    supplierName: supplier.name,
    items: params.items,
    totalAmount: Number(params.items.reduce((s, i) => s + i.amount, 0).toFixed(2)),
    createdBy: params.createdBy ?? 'U-002',
    createdByName: params.createdByName ?? '李娜',
    createdAt: params.createdAt,
    expectedArrival: params.expectedArrival,
    status: params.status,
    approverName: params.approverName,
    approvedAt: params.approvedAt,
    rejectReason: params.rejectReason,
    remark: params.remark,
  };
}

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  mkOrder({
    seq: 1,
    supplierId: 'SUP-001',
    items: [mkItem('PRD-001', 500, 4.2, 500), mkItem('PRD-002', 100, 28.5, 100)],
    status: 'completed',
    createdAt: daysAgo(9),
    expectedArrival: daysAgo(3),
    approverName: '张伟',
    approvedAt: daysAgo(8),
    remark: '季度补货',
  }),
  mkOrder({
    seq: 2,
    supplierId: 'SUP-002',
    items: [mkItem('PRD-005', 200, 22.5, 200), mkItem('PRD-006', 2000, 1.2, 2000)],
    status: 'completed',
    createdAt: daysAgo(8),
    expectedArrival: daysAgo(2),
    approverName: '张伟',
    approvedAt: daysAgo(7),
  }),
  mkOrder({
    seq: 3,
    supplierId: 'SUP-003',
    items: [mkItem('PRD-008', 150, 32, 100)],
    status: 'partial',
    createdAt: daysAgo(7),
    expectedArrival: daysAgo(1),
    approverName: '张伟',
    approvedAt: daysAgo(6),
    remark: '首批到货 100 盒，剩余待补',
  }),
  mkOrder({
    seq: 4,
    supplierId: 'SUP-001',
    items: [mkItem('PRD-003', 200, 6.8), mkItem('PRD-009', 300, 1.8)],
    status: 'approved',
    createdAt: daysAgo(6),
    expectedArrival: daysAgo(3),
    approverName: '张伟',
    approvedAt: daysAgo(5),
    remark: '物流滞留，见物流单 LOG',
  }),
  mkOrder({
    seq: 5,
    supplierId: 'SUP-002',
    items: [mkItem('PRD-010', 300, 5.5)],
    status: 'pending',
    createdAt: daysAgo(2),
    expectedArrival: daysLater(3),
  }),
  mkOrder({
    seq: 6,
    supplierId: 'SUP-007',
    items: [mkItem('PRD-001', 300, 4.0)],
    status: 'pending',
    createdAt: daysAgo(1),
    expectedArrival: daysLater(4),
  }),
  mkOrder({
    seq: 7,
    supplierId: 'SUP-005',
    items: [mkItem('PRD-011', 200, 12)],
    status: 'approved',
    createdAt: daysAgo(5),
    expectedArrival: daysLater(1),
    approverName: '张伟',
    approvedAt: daysAgo(4),
  }),
  mkOrder({
    seq: 8,
    supplierId: 'SUP-004',
    items: [mkItem('PRD-007', 60, 38)],
    status: 'rejected',
    createdAt: daysAgo(4),
    expectedArrival: daysLater(7),
    approverName: '张伟',
    rejectReason: '供应商危化品运输资质已过期，需重新提交审核材料',
  }),
  mkOrder({
    seq: 9,
    supplierId: 'SUP-001',
    items: [mkItem('PRD-010', 200, 5.5), mkItem('PRD-012', 100, 18.5)],
    status: 'draft',
    createdAt: hoursAgo(6),
    expectedArrival: daysLater(6),
  }),
  mkOrder({
    seq: 10,
    supplierId: 'SUP-006',
    items: [mkItem('PRD-004', 80, 45)],
    status: 'cancelled',
    createdAt: daysAgo(6),
    expectedArrival: daysLater(2),
    remark: '供应商已停用，订单取消',
  }),
  mkOrder({
    seq: 11,
    supplierId: 'SUP-003',
    items: [mkItem('PRD-008', 200, 31.5, 200)],
    status: 'completed',
    createdAt: daysAgo(10),
    expectedArrival: daysAgo(4),
    approverName: '张伟',
    approvedAt: daysAgo(9),
  }),
  mkOrder({
    seq: 12,
    supplierId: 'SUP-007',
    items: [mkItem('PRD-009', 800, 1.75, 800)],
    status: 'completed',
    createdAt: daysAgo(5),
    expectedArrival: daysAgo(1),
    approverName: '张伟',
    approvedAt: daysAgo(4),
  }),
];

/* ------------------------------------------------------------------ */
/* 物流                                                                */
/* ------------------------------------------------------------------ */

let eventSeq = 0;
function mkEvent(time: string, node: string, desc: string, location: string): LogisticsEvent {
  eventSeq += 1;
  return { id: `LE-${String(eventSeq).padStart(4, '0')}`, time, node, desc, location };
}

export const LOGISTICS_ORDERS: LogisticsOrder[] = [
  {
    id: 'LOG-001',
    code: 'LOG-20261029-001',
    poId: PURCHASE_ORDERS[3].id,
    poCode: PURCHASE_ORDERS[3].code,
    supplierId: 'SUP-001',
    supplierName: SUPPLIER_MAP['SUP-001'].name,
    carrier: '顺丰速运',
    trackingNo: 'SF1288339001',
    expectedArrival: daysAgo(3),
    status: 'exception',
    delayed: true,
    remark: '华东区域暴雨，中转场滞留',
    events: [
      mkEvent(daysAgo(6), '已揽收', '快件已由供应商仓库发出', '杭州'),
      mkEvent(daysAgo(5), '运输中', '快件离开杭州中转场，发往上海', '杭州'),
      mkEvent(daysAgo(4), '到达中转场', '快件到达上海青浦中转场', '上海'),
      mkEvent(daysAgo(4), '异常滞留', '因暴雨天气导致中转场分拣能力受限，快件滞留', '上海'),
      mkEvent(daysAgo(2), '异常滞留', '中转场恢复部分运力，快件排队待发', '上海'),
    ],
  },
  {
    id: 'LOG-002',
    code: 'LOG-20261030-002',
    poId: PURCHASE_ORDERS[6].id,
    poCode: PURCHASE_ORDERS[6].code,
    supplierId: 'SUP-005',
    supplierName: SUPPLIER_MAP['SUP-005'].name,
    carrier: '中通快运',
    trackingNo: 'ZT7789002233',
    expectedArrival: daysLater(1),
    status: 'in_transit',
    delayed: false,
    events: [
      mkEvent(daysAgo(4), '已揽收', '货物已装车发出', '广州'),
      mkEvent(daysAgo(3), '运输中', '已到达韶关分拨中心', '韶关'),
      mkEvent(daysAgo(1), '运输中', '干线运输中，预计明日到达上海', '南昌'),
    ],
  },
  {
    id: 'LOG-003',
    code: 'LOG-20261027-003',
    poId: PURCHASE_ORDERS[2].id,
    poCode: PURCHASE_ORDERS[2].code,
    supplierId: 'SUP-003',
    supplierName: SUPPLIER_MAP['SUP-003'].name,
    carrier: '德邦物流',
    trackingNo: 'DB5566778899',
    expectedArrival: daysAgo(1),
    status: 'in_transit',
    delayed: false,
    events: [
      mkEvent(daysAgo(6), '已揽收', '首批 100 盒已发出', '上海'),
      mkEvent(daysAgo(5), '运输中', '到达上海分拨中心', '上海'),
      mkEvent(daysAgo(1), '派送中', '货物已进入派送环节', '上海'),
    ],
  },
  {
    id: 'LOG-004',
    code: 'LOG-20261022-004',
    poId: PURCHASE_ORDERS[0].id,
    poCode: PURCHASE_ORDERS[0].code,
    supplierId: 'SUP-001',
    supplierName: SUPPLIER_MAP['SUP-001'].name,
    carrier: '顺丰速运',
    trackingNo: 'SF1288000123',
    expectedArrival: daysAgo(3),
    status: 'delivered',
    delayed: false,
    events: [
      mkEvent(daysAgo(9), '已揽收', '快件已揽收', '杭州'),
      mkEvent(daysAgo(7), '运输中', '到达上海青浦中转场', '上海'),
      mkEvent(daysAgo(3), '已签收', '货物已签收，签收人：张伟', '上海'),
    ],
  },
  {
    id: 'LOG-005',
    code: 'LOG-20261023-005',
    poId: PURCHASE_ORDERS[10].id,
    poCode: PURCHASE_ORDERS[10].code,
    supplierId: 'SUP-003',
    supplierName: SUPPLIER_MAP['SUP-003'].name,
    carrier: '德邦物流',
    trackingNo: 'DB5566770001',
    expectedArrival: daysAgo(4),
    status: 'delivered',
    delayed: false,
    events: [
      mkEvent(daysAgo(10), '已揽收', '货物已发出', '上海'),
      mkEvent(daysAgo(6), '运输中', '到达上海分拨中心', '上海'),
      mkEvent(daysAgo(4), '已签收', '货物已签收，签收人：张伟', '上海'),
    ],
  },
];

// 回填采购单的 logisticsId
LOGISTICS_ORDERS.forEach((lo) => {
  const po = PURCHASE_ORDERS.find((p) => p.id === lo.poId);
  if (po) po.logisticsId = lo.id;
});

/* ------------------------------------------------------------------ */
/* 历史已完成订单                                                       */
/* 目的：让供应商履约指标有 >=2 单有效样本（每单都配一张已签收物流单），    */
/* 同时保留 SUP-004 / SUP-006 样本不足，用于演示“数据不足”分支。           */
/* ------------------------------------------------------------------ */

const HISTORY_ORDERS = [
  { seq: 13, supplierId: 'SUP-001', productId: 'PRD-002', qty: 120, price: 28.5, delayed: false },
  { seq: 14, supplierId: 'SUP-002', productId: 'PRD-005', qty: 150, price: 22.8, delayed: false },
  { seq: 15, supplierId: 'SUP-002', productId: 'PRD-006', qty: 800, price: 1.2, delayed: false },
  { seq: 16, supplierId: 'SUP-002', productId: 'PRD-005', qty: 120, price: 22.8, delayed: true },
  { seq: 17, supplierId: 'SUP-003', productId: 'PRD-008', qty: 180, price: 32, delayed: true },
  { seq: 18, supplierId: 'SUP-005', productId: 'PRD-011', qty: 150, price: 12, delayed: false },
  { seq: 19, supplierId: 'SUP-007', productId: 'PRD-001', qty: 400, price: 4.0, delayed: false },
  { seq: 20, supplierId: 'SUP-005', productId: 'PRD-002', qty: 100, price: 28.5, delayed: false },
  { seq: 21, supplierId: 'SUP-007', productId: 'PRD-009', qty: 500, price: 1.8, delayed: false },
];

HISTORY_ORDERS.forEach((h, idx) => {
  const createdAt = daysAgo(15 + idx * 2);
  const expected = daysAgo(9 + idx * 2);
  const po = mkOrder({
    seq: h.seq,
    supplierId: h.supplierId,
    items: [mkItem(h.productId, h.qty, h.price, h.qty)],
    status: 'completed',
    createdAt,
    expectedArrival: expected,
    approverName: '张伟',
    approvedAt: createdAt,
    remark: '历史订单',
  });
  const logId = `LOG-H${String(idx + 1).padStart(2, '0')}`;
  po.logisticsId = logId;
  PURCHASE_ORDERS.push(po);
  LOGISTICS_ORDERS.push({
    id: logId,
    code: makeCode('LOG', 900 + idx),
    poId: po.id,
    poCode: po.code,
    supplierId: h.supplierId,
    supplierName: SUPPLIER_MAP[h.supplierId].name,
    carrier: '顺丰速运',
    trackingNo: `SF9900${String(idx + 1).padStart(4, '0')}`,
    expectedArrival: expected,
    status: 'delivered',
    delayed: h.delayed,
    remark: h.delayed ? '历史订单，超期 1 天签收' : undefined,
    events: [
      mkEvent(createdAt, '已揽收', '货物已由供应商仓库发出', '供应商仓'),
      mkEvent(expected, '已签收', h.delayed ? '货物已签收（超期）' : '货物已签收，准时到达', '目的地仓'),
    ],
  });
});

/* ------------------------------------------------------------------ */
/* 库存流水 / 调拨                                                      */
/* ------------------------------------------------------------------ */

export const STOCK_TRANSFERS: StockTransfer[] = [
  {
    id: 'TR-001',
    code: makeCode('TR', 1),
    fromWarehouseId: 'WH-02',
    fromWarehouseName: '华南仓',
    toWarehouseId: 'WH-01',
    toWarehouseName: '华东主仓',
    productId: 'PRD-009',
    productName: '无纺布购物袋',
    qty: 200,
    operator: '李娜',
    createdAt: daysAgo(2),
    remark: '华东缺口补齐',
  },
  {
    id: 'TR-002',
    code: makeCode('TR', 2),
    fromWarehouseId: 'WH-03',
    fromWarehouseName: '华北仓',
    toWarehouseId: 'WH-01',
    toWarehouseName: '华东主仓',
    productId: 'PRD-011',
    productName: '珍珠棉填充块',
    qty: 50,
    operator: '李娜',
    createdAt: daysAgo(1),
    remark: '临时调剂',
  },
];

export const INVENTORY_TRANSACTIONS: InventoryTransaction[] = [
  {
    id: 'IT-0001',
    type: 'purchase_in',
    productId: 'PRD-001',
    productName: '五层瓦楞纸箱',
    warehouseId: 'WH-01',
    warehouseName: '华东主仓',
    qty: 500,
    beforeQty: 0,
    afterQty: 500,
    refCode: PURCHASE_ORDERS[0].code,
    operator: '张伟',
    createdAt: daysAgo(3),
    remark: '采购收货入库',
  },
  {
    id: 'IT-0002',
    type: 'purchase_in',
    productId: 'PRD-008',
    productName: '一次性丁腈手套',
    warehouseId: 'WH-01',
    warehouseName: '华东主仓',
    qty: 100,
    beforeQty: 60,
    afterQty: 160,
    refCode: PURCHASE_ORDERS[2].code,
    operator: '张伟',
    createdAt: daysAgo(1),
    remark: '首批到货',
  },
  {
    id: 'IT-0003',
    type: 'transfer_out',
    productId: 'PRD-009',
    productName: '无纺布购物袋',
    warehouseId: 'WH-02',
    warehouseName: '华南仓',
    qty: -200,
    beforeQty: 600,
    afterQty: 400,
    refCode: STOCK_TRANSFERS[0].code,
    operator: '李娜',
    createdAt: daysAgo(2),
    remark: '调拨出库',
  },
  {
    id: 'IT-0004',
    type: 'transfer_in',
    productId: 'PRD-009',
    productName: '无纺布购物袋',
    warehouseId: 'WH-01',
    warehouseName: '华东主仓',
    qty: 200,
    beforeQty: 0,
    afterQty: 200,
    refCode: STOCK_TRANSFERS[0].code,
    operator: '李娜',
    createdAt: daysAgo(2),
    remark: '调拨入库',
  },
  {
    id: 'IT-0005',
    type: 'purchase_in',
    productId: 'PRD-009',
    productName: '无纺布购物袋',
    warehouseId: 'WH-01',
    warehouseName: '华东主仓',
    qty: 800,
    beforeQty: 0,
    afterQty: 800,
    refCode: PURCHASE_ORDERS[11].code,
    operator: '张伟',
    createdAt: daysAgo(1),
    remark: '采购收货入库',
  },
];

/* ------------------------------------------------------------------ */
/* 供应商履约指标（由采购单实时计算，此处给出初始缓存）                    */
/* ------------------------------------------------------------------ */

export const SUPPLIER_METRICS: Record<string, SupplierMetrics> = {
  'SUP-001': { orderCount: 3, completedCount: 3, delayCount: 0, onTimeRate: 1 },
  'SUP-002': { orderCount: 2, completedCount: 2, delayCount: 0, onTimeRate: 1 },
  'SUP-003': { orderCount: 2, completedCount: 2, delayCount: 1, onTimeRate: 0.5 },
  'SUP-004': { orderCount: 1, completedCount: 0, delayCount: 0, onTimeRate: null },
  'SUP-005': { orderCount: 1, completedCount: 0, delayCount: 0, onTimeRate: null },
  'SUP-006': { orderCount: 1, completedCount: 0, delayCount: 0, onTimeRate: null },
  'SUP-007': { orderCount: 2, completedCount: 2, delayCount: 0, onTimeRate: 1 },
};

/* ------------------------------------------------------------------ */
/* AI：任务 / 报告 / 会话                                              */
/* ------------------------------------------------------------------ */

export const AGENT_TASKS: AgentTask[] = [
  {
    id: 'TASK-001',
    name: '物流延迟影响分析',
    type: 'logistics_analysis',
    createdBy: '李娜',
    createdAt: daysAgo(1),
    status: 'done',
    summary: '物流单 LOG-20261029-001 延误 3 天，将影响 PRD-003 的补货节奏，建议改走华南仓调拨。',
    toolCalls: [
      { name: 'query_logistics', params: '{ "logisticsId": "LOG-001" }', status: 'success', durationMs: 182 },
      { name: 'query_purchase_orders', params: '{ "poId": "PO-004" }', status: 'success', durationMs: 143 },
      { name: 'query_inventory', params: '{ "productIds": ["PRD-003", "PRD-009"] }', status: 'success', durationMs: 96 },
    ],
    resultText: '已生成《物流异常分析报告》，并在 AI 分析报告中保存。',
  },
  {
    id: 'TASK-002',
    name: '库存补货建议计算',
    type: 'replenishment',
    createdBy: '李娜',
    createdAt: hoursAgo(5),
    status: 'waiting_confirm',
    summary: 'PRD-003 食品级 PE 保鲜袋当前缺货，建议采购 300 包。',
    toolCalls: [
      { name: 'query_inventory', params: '{ "productId": "PRD-003" }', status: 'success', durationMs: 88 },
      { name: 'calculate_replenishment', params: '{ "productId": "PRD-003" }', status: 'success', durationMs: 61 },
    ],
    payload: {
      supplierId: 'SUP-001',
      supplierName: '杭州汇通包装材料有限公司',
      items: [
        {
          productId: 'PRD-003',
          productName: '食品级 PE 保鲜袋',
          spec: '30×40cm 100只/包',
          unit: '包',
          qty: 300,
          price: 6.8,
        },
      ],
      totalAmount: 2040,
      basis: [
        '安全库存：500 包',
        '当前可用库存：0 包（全部仓库合计）',
        '已审批未收货：200 包（采购单在途）',
        '建议采购量 = max(0, 500 − 0 − 200) = 300 包',
      ],
      expectedArrival: daysLater(5),
    },
  },
  {
    id: 'TASK-003',
    name: '供应商履约分析',
    type: 'supplier_analysis',
    createdBy: '张伟',
    createdAt: daysAgo(2),
    status: 'done',
    summary: '上海鼎盛劳保用品厂近 2 单中 1 单延迟，准时交付率 50%，建议增加备选供应商。',
    toolCalls: [
      { name: 'query_supplier', params: '{ "supplierId": "SUP-003" }', status: 'success', durationMs: 121 },
      { name: 'query_purchase_orders', params: '{ "supplierId": "SUP-003" }', status: 'success', durationMs: 154 },
    ],
    resultText: '已生成《供应商风险分析报告》。',
  },
  {
    id: 'TASK-004',
    name: '低库存商品补货草稿',
    type: 'purchase_draft',
    createdBy: '李娜',
    createdAt: hoursAgo(2),
    status: 'waiting_confirm',
    summary: '为 PRD-002 气泡膜卷生成采购草稿，建议采购 150 卷。',
    toolCalls: [
      { name: 'query_inventory', params: '{ "category": "包装材料" }', status: 'success', durationMs: 132 },
      { name: 'calculate_replenishment', params: '{ "productId": "PRD-002" }', status: 'success', durationMs: 58 },
      { name: 'create_purchase_draft', params: '{ "productId": "PRD-002", "qty": 150 }', status: 'success', durationMs: 210 },
    ],
    payload: {
      supplierId: 'SUP-005',
      supplierName: '广州联创包装科技有限公司',
      items: [
        {
          productId: 'PRD-002',
          productName: '气泡膜卷',
          spec: '50cm×100m',
          unit: '卷',
          qty: 150,
          price: 28.5,
        },
      ],
      totalAmount: 4275,
      basis: ['安全库存：200 卷', '当前可用库存：70 卷', '已审批未收货：0 卷', '建议采购量 = max(0, 200 − 70 − 0) = 130 卷，按起订量 10 卷取整为 130'],
      expectedArrival: daysLater(6),
    },
  },
  {
    id: 'TASK-005',
    name: '物流轨迹批量分析',
    type: 'logistics_analysis',
    createdBy: '王强',
    createdAt: daysAgo(3),
    status: 'failed',
    summary: '批量分析 42 个物流单时上游接口超时。',
    toolCalls: [
      { name: 'query_logistics', params: '{ "page": 1, "pageSize": 42 }', status: 'failed', durationMs: 30000 },
    ],
    error: '下游物流查询接口超时（30s），已消耗 1 次重试预算，任务终止。',
  },
];

export const AI_REPORTS: AiReport[] = [
  {
    id: 'RPT-001',
    type: 'logistics_anomaly',
    title: '物流异常分析报告 · LOG-20261029-001',
    targetName: 'LOG-20261029-001',
    targetId: 'LOG-001',
    createdAt: daysAgo(1),
    conclusion: '物流单已延误 3 天，主要原因为华东区域暴雨导致中转场滞留，非供应商责任。',
    evidence: [
      { label: '采购订单', value: PURCHASE_ORDERS[3].code },
      { label: '供应商', value: '杭州汇通包装材料有限公司' },
      { label: '预计到达', value: '已超期 3 天' },
      { label: '在途商品', value: 'PRD-003 × 200 包、PRD-009 × 300 个' },
      { label: '当前库存', value: 'PRD-003 为 0（缺货）、PRD-009 为 600' },
    ],
    cause: '轨迹显示快件到达上海青浦中转场后连续 3 天滞留，节点说明为“暴雨天气导致分拣能力受限”，属承运商运力异常，非供应商发货问题。',
    suggestions: [
      '优先从华南仓调拨无纺布购物袋 200 个到华东主仓，缓解缺口',
      'PRD-003 当前为 0 库存且该单在途，建议同时发起一次小批量紧急采购',
      '与顺丰确认新的到达时间，超过 5 天可依合同条款主张运费补偿',
    ],
  },
  {
    id: 'RPT-002',
    type: 'replenishment',
    title: '库存补货分析报告 · PRD-003',
    targetName: '食品级 PE 保鲜袋',
    targetId: 'PRD-003',
    createdAt: hoursAgo(5),
    conclusion: '食品级 PE 保鲜袋已缺货，在途 200 包，建议立即采购 300 包。',
    evidence: [
      { label: '安全库存', value: '500 包' },
      { label: '当前可用库存', value: '0 包' },
      { label: '已审批未收货', value: '200 包' },
      { label: '建议采购量', value: '300 包' },
      { label: '参考单价', value: '¥6.80 / 包' },
    ],
    cause: '该商品在三个仓库的库存均已清零，且唯一在途采购单（PO-004）因物流滞留未到货，短期内无法覆盖安全库存。',
    suggestions: ['生成 300 包采购草稿并提交审批', '同步跟催 PO-004 物流', '考虑将安全库存从 500 包上调至 600 包'],
  },
  {
    id: 'RPT-003',
    type: 'supplier_risk',
    title: '供应商风险分析报告 · 上海鼎盛劳保用品厂',
    targetName: '上海鼎盛劳保用品厂',
    targetId: 'SUP-003',
    createdAt: daysAgo(2),
    conclusion: '该供应商近 2 单中 1 单延迟，准时交付率 50%，低于 80% 的合格线，存在交付风险。',
    evidence: [
      { label: '关联订单数', value: '2 单' },
      { label: '已完成订单', value: '2 单' },
      { label: '延迟订单', value: '1 单' },
      { label: '准时交付率', value: '50.0%' },
    ],
    cause: '订单 PO-003 原定 1 天前到达，实际仅到货 100/150 盒，剩余部分尚未发出；供应商未主动同步延期原因。',
    suggestions: ['将该供应商降为备选，新订单优先走无锡金诚纸制品厂', '要求供应商补充书面交付计划', '在采购员侧增加交付跟催提醒'],
  },
];

export const AI_CONVERSATIONS: AiConversation[] = [
  {
    id: 'CONV-001',
    title: '哪些商品库存不足？',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    messages: [
      {
        id: 'MSG-001',
        role: 'user',
        content: '哪些商品库存不足？',
        at: daysAgo(1),
      },
      {
        id: 'MSG-002',
        role: 'assistant',
        content: '当前有 6 个商品处于缺货或低库存状态。',
        at: daysAgo(1),
        reply: {
          conclusion: '当前有 1 个商品缺货、5 个商品低库存，主要集中在包装材料类。',
          evidence: [
            { label: '缺货商品', value: '食品级 PE 保鲜袋（0 / 安全库存 500）' },
            { label: '低库存商品', value: '五层瓦楞纸箱、气泡膜卷、不锈钢保温杯、工业酒精、无纺布购物袋' },
            { label: '数据来源', value: 'warehouse_stock 汇总 + products.safety_stock' },
          ],
          actions: ['对缺货商品生成补货建议', '查看库存预警列表'],
          toolCalls: [{ name: 'query_inventory', params: '{ "level": ["out", "low"] }', status: 'success', durationMs: 104 }],
        },
      },
    ],
  },
];



