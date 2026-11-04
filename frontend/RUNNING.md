# SupplyMind 本地运行说明

> 本文基于「前后端 + 数据库合并到同一个 PyCharm 项目」后的结构（项目根目录 `SupplyMind/`）。

## 项目结构

| 组件 | 位置（本仓库） | 地址 |
| --- | --- | --- |
| 前端（Vite + React） | `frontend/` | http://127.0.0.1:5273 |
| 后端（FastAPI） | `backend/` | http://127.0.0.1:8000/docs |
| 数据库（MySQL 8.4） | 本机 MySQL（`database/` 放建库脚本） | 127.0.0.1:3306 / 库 `supplymind` |
| AI 对话流（Dify，可选） | 外部服务，默认关闭 | 见 `backend/.env` 的 `DIFY_*` |

默认账号：`gm / 123456`（管理者）、`sales01 / 123456`（采购员）。

## 在 PyCharm 里跑

直接用根目录的 `SupplyMind` 项目（已配好 `.idea`、解释器、两个运行配置）：

**后端**：
1. Python 解释器选本机 Anaconda（路径以你机器为准，例如 `F:\HeiMaChengxuyuan\anaconda\python.exe`）。
2. 右上角运行配置选「**后端 FastAPI (8000)**」，点 Run。
   - 跑的是 `backend/run.py`，端口 8000，带热重载；
   - `run.py` 里加了自检：**MySQL 没起来会自动拉 `mysqld.exe`**，不用先手动开数据库。
3. 看到 `Uvicorn running on http://127.0.0.1:8000` 就是成功，文档 http://127.0.0.1:8000/docs。

**前端**：
1. 运行配置选「**前端 dev (pnpm)**」（pnpm dev），点 Run。
2. 打开 http://127.0.0.1:5273 ，登录 `gm / 123456`。

> 也可以直接双击根目录 `start-all.cmd` 一键启动（MySQL → 后端 → 前端 → 打开浏览器）。
> 端口被占时前端会自己换到 5274，但 Vite 代理仍指向 8000，功能不受影响。
> 页面残留旧状态时按 `Ctrl+F5` 硬刷新。

## 启动 / 停止

- 一键启动：双击根目录 `start-all.cmd`
  - 依次检查并启动 MySQL(3306) → 后端(8000) → 前端(5273)，已在运行的服务自动跳过；启动完自动打开 http://127.0.0.1:5273。
- 一键停止：双击根目录 `stop-all.cmd`（可选择是否连 MySQL 一起关）。
- 只启动前端：在 `frontend/` 执行 `pnpm dev`（pnpm 不在 PATH 时退回 `node node_modules/vite/bin/vite.js`）。

## 前后端联调关系

- 前端 `services/http.ts` 固定用 `/api/v1`，开发期由 Vite 代理到 `http://127.0.0.1:8000`，同源、无 CORS。
- 登录：`POST /api/v1/auth/login` → JWT 存 localStorage（`sm_token`），之后请求带 `Authorization: Bearer`。
- 右下角 AI 小助手：前端 → 后端 `/api/v1/ai/dify/chat/stream`（SSE 转发）→ Dify `/v1/chat-messages`。
  这样 API Key 不出现在浏览器里，也绕开了 Dify 的 CORS。

## Dify 接入（可选，默认关闭）

- `backend/.env` 里 `DIFY_ENABLED=false`，默认不走 Dify，AI 助手走本地规则引擎兜底。
- 要启用：在你自己的 Dify 里用 `frontend/dify/supplier-quote-eval.dsl.yml` 导入应用 →
  拿到你自己的 `DIFY_API_KEY` 和 `DIFY_API_BASE` → 填进 `backend/.env`，把 `DIFY_ENABLED` 改 `true` 重启后端。
- 验证是否通：打开小助手面板，标题下应显示「在线」；或访问
  `GET /api/v1/ai/dify/status?force=true`（需登录）。

## 已知问题与处理（历史排错记录）

1. MySQL 服务方式启动被系统拒绝 → 改为直接拉起 `mysqld.exe`（一键脚本已内置）。
2. 数据库 `products` 缺 `sub_category` 列 → 执行 `scripts/migrate_product_sub_category.py`。
3. 历史 AI 会话 `ai_messages.evidence` 是对象、新版 schema 要数组 → 后端出参统一归一化，历史消息不再 500。
4. `成品` 大类没有可供应公司 → `scripts/fix_demo_categories.py` 给 SUP001 补上，并补齐 10 个商品的小类。
5. 前端「新窗口打开 Dify」写死旧地址 → 改为跟随后端探测到的 `base_url`（通过 `VITE_AI_BOT_URL` 配置）。
6. 前端 `start-all.cmd` 中文编码把批处理搞崩 → 脚本改纯 ASCII，路径走仓库内相对路径。
7. `favicon.ico` 404 → `index.html` 指向 `public/icon.png`。
8. 数据库约束 `chk_po_approver`（approver <> created_by）和「GM 提交免审批」冲突：
   GM 提交自己的采购单会直接 500（MySQL 3819）。已删掉该 CHECK，`schema-mysql.sql` 里也加了说明。
9. AI 补货草稿会把不同大类的商品塞进同一张单，且可能包含停用商品：
   确认时被 `SUPPLIER_CATEGORY_MISMATCH` / `PRODUCT_INACTIVE` 拒绝。
   已修：补货建议跳过停用商品；草稿按供应商主营大类收敛，并挑能覆盖最多商品的那家供应商。
10. 自定义校验器（如「同一商品不能重复」）抛 ValueError 时，422 处理函数自己又炸成 500：
    `main.py` 里报错明细先用 `json.dumps(..., default=str)` 洗一遍再返回。
11. 并发写库存不安全：同时收货会 409（两个请求一起 INSERT warehouse_stock），
    同时调拨会 500（InnoDB 死锁 1213）；并发收货还会超收（各自按旧 received_qty 校验）。
    已修三处：
    - `apply_stock_change` 在 MySQL 上用 `INSERT ... ON DUPLICATE KEY UPDATE` / 条件 UPDATE，原子增减；
    - 库存写操作先锁一行 `system_configs` 当互斥量，事务结束自动释放；
    - 收货前 `SELECT ... FOR UPDATE` 锁采购明细行，按最新已收数量判断剩余量。
12. 「按库存不足生成采购草稿」被意图识别分到「采购订单查询」，草稿卡片不出现：
    已加规则——出现「生成/草稿/下单」+「补货/库存不足/安全库存」时优先走补货分支。

## 自检脚本

`frontend/.tmp/e2e/smoke.mjs`（Node + puppeteer-core + 本机 Edge）：

```bat
cd /d frontend/.tmp/e2e
node smoke.mjs
```

覆盖：登录页 / 错误密码 / gm 登录 / 12 个业务页 / 采购单详情 / AI 小助手流式对话 /
AI 智能中心对话 / AI 采购草稿卡片 / 采购员角色菜单限制。截图输出到 `frontend/.shots`。

写操作联调（建单→提交→收货→调拨→审批→AI 草稿确认→建号）用另一套脚本，
跑在克隆库上避免污染正式数据：

```bat
rem 1) 克隆库
mysqldump ... supplymind > verify_tables.sql
rem 2) 8001 端口起一个指向 supplymind_verify 的后端
rem 3) 执行
python frontend/.tmp/e2e/write_flows.py http://127.0.0.1:8001
```

最近一次结果：19 项全过（`write_flows_result.json`）。
