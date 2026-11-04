/**
 * 服务门面
 *
 * 页面永远只 `import { xxxApi } from '@/services/api'`。
 * 通过 VITE_API_MODE 在 mock / real 之间切换：
 *   - real（默认）：走 FastAPI 后端（/api/v1，Vite 代理到 127.0.0.1:8000）
 *   - mock：走本地内存 + localStorage 的演示数据
 *
 * 切换方式：在 .env.local 里写 VITE_API_MODE=mock
 */

import * as mock from './mockApi';
import * as real from './realApi';

export const API_MODE: 'mock' | 'real' =
  (import.meta.env as unknown as Record<string, string>).VITE_API_MODE === 'mock' ? 'mock' : 'real';

/** real 与 mock 的公开方法集合一致，统一按 real 的类型使用 */
const impl = (API_MODE === 'real' ? real : (mock as unknown as typeof real)) as typeof real;

/* ---- 业务接口：由模式决定实现 ---- */
export const dashboardApi = impl.dashboardApi;
export const supplierApi = impl.supplierApi;
export const productApi = impl.productApi;
export const warehouseApi = impl.warehouseApi;
export const stockApi = impl.stockApi;
export const purchaseOrderApi = impl.purchaseOrderApi;
export const logisticsApi = impl.logisticsApi;
export const transferApi = impl.transferApi;
export const transactionApi = impl.transactionApi;
export const difyApi = impl.difyApi;
export type { DifyStatus, DifyStreamHandlers } from './realApi';

/* ---- AI 智能中心对话：独立服务（真实模式读写数据库） ---- */
export { aiApi, AI_CHAT_MODE, feedbackApi, knowledgeApi, optimizeApi, reportApi, reportScheduleApi } from './ai';
export type { AiChatPayload, AiChatResult } from './ai';

/* ---- 认证：mock 模式没有真实登录，用当前用户兜底 ---- */
export const authApi = {
  login:
    API_MODE === 'real'
      ? real.authApi.login
      : async () => mock.authApi.me(),
  me: impl.authApi.me,
  users: impl.authApi.users,
  switchUser: impl.authApi.switchUser,
  logout:
    API_MODE === 'real'
      ? real.authApi.logout
      : async () => {
          /* mock 模式无需登出 */
        },
};

/* ---- 演示工具：始终来自 mock；真实模式下 reset 会明确拒绝 ---- */
export const demoApi = mock.demoApi;

export const currentUser = impl.currentUser;

/* ---- 类型再导出，保持既有 import 不变 ---- */
export type {
  DashboardSummary,
  DashboardTodo,
  DashboardAlert,
  SupplierQuery,
  PoQuery,
  PoCreatePayload,
  ReceivePayload,
  LogisticsQuery,
  TransferPayload,
  TxQuery,
  ProductQuery,
} from './mockApi';


