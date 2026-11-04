#   前端（React + TypeScript + Vite）

AI 智能供应链管理平台 · MVP 前端骨架。**当前只做前端，全部数据为 Mock，后端接口未接入。**

产品需求来源：《  MVP 模块精简版产品规划（建议版本 1.1）》。

---

## 一、怎么跑起来

```bash
# 安装依赖（仓库已带 .npmrc 与 pnpm-workspace.yaml，无需额外配置）
pnpm install

# 启动开发服务器
pnpm dev          # http://localhost:5273

# 生产构建
pnpm build
pnpm preview
```

> 依赖安装说明：本项目使用 `node-linker=hoisted` + `shamefullyHoist`，
> 以避免 pnpm 在 Windows 上创建符号链接时报 `Maximum call stack size exceeded`。

### 在 PyCharm 里运行

`.idea/` 已经配好了，正常情况下直接点右上角的 **`dev (pnpm)`** 运行配置即可。

如果 PyCharm 里 `pnpm` 仍然"找不到"，几乎都是同一个原因：
**PyCharm 进程比 Node.js 的环境变量更早启动，Windows 不会把新的 PATH 注入已在运行的进程。**

两种解法（任选其一）：

1. **彻底退出再打开**：File → Exit（不是关闭项目、也不是最小化），重新打开项目。
   之后终端里 `pnpm -v` 就能用，运行配置也会被重新加载。
2. **不想重启 IDE**：用 PyCharm 内置终端（`Alt` + `F12`），直接执行

   ```powershell
   .\start-dev.cmd
   ```

   `start-dev.cmd` 会自己把 Node 目录塞进 PATH，不依赖 PyCharm 继承的环境，
   所以哪怕 PyCharm 是早于 Node 启动的也能跑起来。

> 补充：如果项目在 PyCharm 里被识别成 Python 项目（模块类型 `PYTHON_MODULE`、
> 没有 JS 补全、右键没有"运行"），把 `.idea/ -web.iml` 第一行改成
> `type="WEB_MODULE"` 再重启 IDE。本仓库已改好，并且排除了
> `node_modules` / `dist`，避免 IDE 索引几万个文件。

---

## 二、技术栈与一处取舍

| 层 | PRD 建议 | 本项目实际 | 说明 |
|---|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite | **React 18 + TypeScript + Vite** | 按需求改为 React |
| UI | Element Plus | **Ant Design 5** | React 生态里与 Element Plus 对位的后台组件库 |
| 图表 | ECharts | ECharts 5（自行封装 `EChart` 组件） | 不额外引入 `echarts-for-react` |
| 路由 | — | react-router-dom 6 | 多页面 + 详情页深链 |
| 数据 | — | Mock（内存 + localStorage） | 刷新不丢，可一键重置 |

---

## 三、页面清单（对照 PRD 第 1、2 节）

| 一级入口 | 页面 | 路由 | 实现状态 |
|---|---|---|---|
| **工作台** | 经营总览、待办、异常提醒、AI 今日洞察、近 7 天趋势 | `/dashboard` | ✅ KPI 可点击并带筛选跳转 |
| **采购管理** | 供应商列表 / 详情 | `/purchase/suppliers`、`/purchase/suppliers/:id` | ✅ 增改、启停、搜索筛选、履约指标 |
| | 采购订单 / 详情 | `/purchase/orders`、`/purchase/orders/:id` | ✅ 建草稿、提交、审批、驳回、收货、取消 |
| | 物流跟踪 / 详情 | `/purchase/logistics`、`/purchase/logistics/:id` | ✅ 轨迹时间线、模拟更新节点、延迟标记 |
| **商品与库存** | 商品管理 | `/catalog/products` | ✅ 增改、启停、关键字与分类筛选 |
| | 库存总览 | `/catalog/stock` | ✅ 各仓分布可展开、缺货/低库存筛选 |
| | 库存预警 | `/catalog/alerts` | ✅ 缺货/低库存分档、缺口、建议采购量、AI 补货建议 |
| | 仓库管理 | `/catalog/warehouses` | ✅ 增改、启停、跳转该仓库存 |
| | 库存流水与调拨 | `/catalog/transactions` | ✅ 流水（带前后结存）、新建调拨（校验可用库存） |
| **AI 智能中心** | AI 对话 | `/ai/chat` | ✅ 会话列表、结构化回复、草稿确认卡片 |
| | Agent 任务中心 | `/ai/tasks` | ✅ 状态筛选、工具调用摘要、确认/取消/重试 |
| | AI 分析报告 | `/ai/reports` | ✅ 报告列表、详情、一键复制 |
| **系统设置** | 用户与角色、业务规则、接口对接说明 | `/settings` | ✅ 含"重置演示数据" |
| **全局** | AI 助手抽屉 | 任意页面右上角 | ✅ 自动携带页面上下文 |

通用交互（PRD 第 6 节）：列表页统一有搜索、筛选、重置、分页、加载态、空状态；表单有必填校验、提交中状态、成功反馈、二次确认（审批/驳回/收货/调拨/停用）。

---

## 四、Mock 层怎么组织的

```text
src/
├─ layout/          统一布局、侧边导航、全局 AI 抽屉（AiContext）
├─ pages/           dashboard / purchase / catalog / ai / Settings
├─ components/      PageHeader、StatusTag、EChart、AiReplyView
├─ services/
│  ├─ api.ts        ★ 所有接口的唯一出口
│  └─ rules.ts      业务规则（库存状态、补货公式、履约指标、延迟判定）
├─ mock/
│  ├─ seed.ts       种子数据：7 家供应商 / 12 个商品 / 3 个仓库 / 12 张采购单 / 5 单物流
│  ├─ db.ts         内存仓储 + localStorage 持久化 + 变更广播
│  └─ agent.ts      Mock Agent：意图识别 + 7 个工具 + 任务/报告落库
├─ hooks/useRequest.ts  加载态 / 错误态 / 数据变更自动刷新
├─ utils/format.ts  金额、日期、单号格式化
└─ types.ts         ★ 领域模型 = 前后端契约
```

### 四、1 Mock Agent 的 7 个工具

与 PRD 第 3 节一一对应，每次调用都会记录 `name / params / status / durationMs`：

`query_inventory`、`query_purchase_orders`、`query_supplier`、`query_logistics`、
`calculate_replenishment`、`create_purchase_draft`、`retrieve_business_knowledge`

统一回复结构：**结论 / 数据依据 / 原因分析 / 建议动作 / 可执行操作**。
涉及写入的动作（生成采购草稿）会产出 `PurchaseDraftPayload`，前端渲染成确认卡片，
必须点「确认创建」才真正落库，且不会自动审批。

### 四、2 已经在前端落实的业务规则

| 规则（PRD 出处） | 实现位置 |
|---|---|
| 建议采购量 = max(0, 安全库存 − 当前可用库存 − 已审批未收货) | `services/rules.ts` |
| 库存为 0 → 缺货；< 安全库存 → 低库存 | `services/rules.ts` |
| 创建人与审批人不能相同 | `api.purchaseOrderApi.approve` 抛错 |
| 收货数量不能超过剩余未收数量 | `api.purchaseOrderApi.receive` 先整体校验再写 |
| 库存更新与流水写入同一事务 | 同上：一次性改 `warehouseStock` + 写 `inventoryTransactions` |
| 调拨校验调出仓可用库存，扣减与增加同时完成 | `api.transferApi.create` |
| 超过预计到达时间且未送达 → 延迟 | `services/rules.ts` `isLogisticsDelayed` |
| 准时交付率样本 < 2 单显示"数据不足" | `services/rules.ts` `supplierMetrics` |
| 有库存的仓库 / 有未完成订单的供应商不能停用 | `warehouseApi.setStatus` / `supplierApi.setStatus` |

---

## 五、接后端要改哪里

**只改一处：`src/services/api.ts`。** 页面层不依赖任何 mock 实现。

1. 把每个函数的函数体换成 `fetch`，例如：

```ts
submit: async (id: string) => {
  const res = await fetch(`/api/purchase-orders/${id}/submit`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
},
```

2. 删掉 `mock/db.ts` 里的 `localStorage` 持久化与 `mock/seed.ts` 的种子数据；
3. 保留 `types.ts` 作为契约，`rules.ts` 里的计算可以留给后端做（前端只做展示）。

接口对照表已经做成了页面：**系统设置 → 接口对接说明**（约 18 个端点）。

---

## 六、已知待办（下一步）

- [ ] 后端接入后，把 `useRequest` 换成 TanStack Query / SWR（当前是手写的最小实现）
- [ ] 供应商与商品的批量操作、导出
- [ ] 工作台趋势支持切换"金额 / 单量"、时间范围选择
- [ ] 权限落地：按角色隐藏操作按钮（当前角色信息已在 `User.role`，尚未用于 UI 控制）
- [ ] 表单"未保存离开提醒"（`useBeforeUnload`）
- [ ] 组件级单测 / Playwright 冒烟用例

---

## 十一、视觉设计系统（暖橙主题）

配色与字体来自 `ui-ux-pro-max` 数据库检索：
调色板 **"Warm ink + amber accent on cream"**（#FFFBEB 奶油底 / 暖灰墨色文字 / 琥珀强调），
字体配对 **"Chinese Simplified"**（Noto Sans SC，带系统中文字体回退）。

完整 token 定义在 [`src/styles/theme.css`](src/styles/theme.css)：

| token | 值 | 用途 |
|---|---|---|
| `--sm-bg` | `#fffaf4` | 页面奶油底 |
| `--sm-card` | `#ffffff` | 卡片 |
| `--sm-border` | `#f1e6db` | 暖色描边 |
| `--sm-primary` | `#f26522` | 主色 / CTA |
| `--sm-primary-soft` | `#fff0e2` | 选中态底色 |
| `--sm-radius-card` | `18px` | 卡片圆角 |

### Magic UI 组件的处理方式

Magic UI 官方要求 **Tailwind + shadcn**。本项目是 Ant Design + 原生 CSS，
引入 Tailwind 会带来 preflight 重置并与 antd 组件样式冲突，为了 4 个动效不值得。

因此按 Magic UI 的**组件 API 与动画行为**，用原生 CSS 做了等价实现（零新增依赖）：

| Magic UI | 本项目 | 位置 |
|---|---|---|
| `NumberTicker` | 数字滚动（rAF + easeOutExpo） | `src/components/magic/NumberTicker.tsx` |
| `ShimmerButton` | 光带扫过的渐变 CTA | `src/components/magic/ShimmerButton.tsx` |
| `BlurFade` / `BorderBeam` / `DotPattern` | 入场、边框流光、点阵底纹 | `src/components/magic/Motion.tsx` |

全部尊重 `prefers-reduced-motion`：开启减少动效时动画关闭、元素直接可见。

### 页面结构对照参考图

- **登录页**（`/login`）：左侧品牌区 + 右侧登录卡，密码 / 短信双 Tab
- **工作台**：问候区 → 6 个 KPI → 采购趋势 + 待办 → 异常提醒 + AI 洞察
- **采购管理 / 商品与库存 / AI 智能中心**：统一使用胶囊二级导航（`ModuleTabs`）
- **库存总览**：KPI 条 + 库存分布环图 + 热门商品 TOP5 + 明细表

---

## 十二、前后端联调

前端默认走**真实后端**（`VITE_API_MODE` 未设置时为 `real`）。

### 启动顺序

```powershell
# 1) 后端（MySQL 需先启动，库名  ）
cd backend
python run.py                 # http://127.0.0.1:8000/docs

# 2) 前端
cd frontend
pnpm dev                      # http://localhost:5273
```

Vite 已配置代理：前端 `/api/*` → `http://127.0.0.1:8000/api/v1/*`，同源、无 CORS 问题。

### 演示账号

| 账号 | 密码 | 角色 |
|---|---|---|
| `gm` | `123456` | 总经理（可审批） |
| `sales01` | `123456` | 销售/采购 |
| `sales02` | `123456` | 销售/采购 |

### 已接入（只读）

工作台、供应商（列表/详情/履约指标/关联订单）、采购订单（列表/详情）、物流（列表/详情/新增节点）、
商品、仓库、库存预警、库存流水、调拨记录。

### 尚未接入

写操作（新建/编辑/审批/收货/调拨）与 AI 对话模块目前仍走前端 mock，
真实模式下点击会明确提示「尚未接入后端」，不会静默失败。

### 切换回纯 mock

新建 `D:\新建文件夹 (4)\ -web\.env.local`：

```
VITE_API_MODE=mock
```

重启 `pnpm dev` 即可完全脱离后端运行（数据来自 localStorage）。

### 开发期调试技巧

开发环境支持用 URL 注入登录态，方便截图与联调：

```
http://localhost:5273/dashboard?token=<access_token>
```
