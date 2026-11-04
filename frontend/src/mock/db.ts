/**
 * Mock 数据仓库
 *
 * 目前数据存在内存 + localStorage，刷新不丢。
 * 接入后端时：把 services/api.ts 里的函数体换成 fetch 即可，页面层不需要改。
 */

import type { AgentTask, AiConversation, AiReport } from '@/types';
import {
  AGENT_TASKS,
  AI_CONVERSATIONS,
  AI_REPORTS,
  INVENTORY_TRANSACTIONS,
  LOGISTICS_ORDERS,
  PRODUCTS,
  PURCHASE_ORDERS,
  STOCK_TRANSFERS,
  SUPPLIERS,
  USERS,
  WAREHOUSE_STOCK,
  WAREHOUSES,
} from './seed';

const STORAGE_KEY = ' :mock:v3';
const CHANGE_EVENT = 'sm:db-changed';

export interface Seq {
  po: number;
  tr: number;
  it: number;
  log: number;
  event: number;
  task: number;
  report: number;
  supplier: number;
  product: number;
  warehouse: number;
  conv: number;
  msg: number;
}

export interface Db {
  users: typeof USERS;
  currentUserId: string;
  suppliers: typeof SUPPLIERS;
  products: typeof PRODUCTS;
  warehouses: typeof WAREHOUSES;
  warehouseStock: typeof WAREHOUSE_STOCK;
  purchaseOrders: typeof PURCHASE_ORDERS;
  logisticsOrders: typeof LOGISTICS_ORDERS;
  inventoryTransactions: typeof INVENTORY_TRANSACTIONS;
  stockTransfers: typeof STOCK_TRANSFERS;
  agentTasks: AgentTask[];
  aiReports: AiReport[];
  aiConversations: AiConversation[];
  seq: Seq;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function createDb(): Db {
  return {
    users: clone(USERS),
    currentUserId: USERS[0].id,
    suppliers: clone(SUPPLIERS),
    products: clone(PRODUCTS),
    warehouses: clone(WAREHOUSES),
    warehouseStock: clone(WAREHOUSE_STOCK),
    purchaseOrders: clone(PURCHASE_ORDERS),
    logisticsOrders: clone(LOGISTICS_ORDERS),
    inventoryTransactions: clone(INVENTORY_TRANSACTIONS),
    stockTransfers: clone(STOCK_TRANSFERS),
    agentTasks: clone(AGENT_TASKS),
    aiReports: clone(AI_REPORTS),
    aiConversations: clone(AI_CONVERSATIONS),
    seq: {
      po: 100,
      tr: 100,
      it: 100,
      log: 100,
      event: 100,
      task: 100,
      report: 100,
      supplier: 100,
      product: 100,
      warehouse: 100,
      conv: 100,
      msg: 100,
    },
  };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDb();
    const parsed = JSON.parse(raw) as Db;
    // 简易兼容：字段缺失时用种子数据补齐
    const base = createDb();
    return { ...base, ...parsed, seq: { ...base.seq, ...(parsed.seq ?? {}) } };
  } catch {
    return createDb();
  }
}

let db: Db = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* 忽略配额超限 */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 读取（只读用途，不要直接改返回值） */
export function getDb(): Db {
  return db;
}

/** 所有写操作统一走这里：执行变更 → 持久化 → 广播 */
export function mutate<T>(fn: (draft: Db) => T): T {
  const result = fn(db);
  persist();
  return result;
}

/** 重置为初始种子数据（演示 / 联调常用） */
export function resetDb(): void {
  db = createDb();
  persist();
}

export function nextSeq(key: keyof Seq): number {
  db.seq[key] += 1;
  return db.seq[key];
}

export function onChange(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** 模拟网络延迟，让加载态、骨架屏有东西可测 */
export function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function fail(message: string, ms = 240): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}


