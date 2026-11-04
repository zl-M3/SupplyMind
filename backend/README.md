# SupplyMind 后端（AI 智能供应链管理平台 · MVP）

基于 **FastAPI + SQLAlchemy + MySQL** 的单体后端，实现《SupplyMind_MVP模块精简版规划》中的工作台、采购管理、商品与库存、AI 智能中心、系统设置五大模块，并内置一个带 **7 个白名单工具** 的 AI 主 Agent（无 API Key 时自动降级为规则引擎，保证离线可演示三个必备场景）。

- **交互式接口文档**：启动后访问 <http://127.0.0.1:8000/docs>（85 个接口）
- **同步 SQLAlchemy + 同步端点**：事务语义直观，`def` 端点由 FastAPI 线程池执行
- **库存更新与流水写入同事务**、**创建人不能审批自己的订单**、**收货量不能超过剩余未收数量** 等业务规则在服务层强制校验
- **AI 只读工具 + 草稿确认制**：Agent 不直连数据库、不执行任意 SQL，写操作一律「生成草稿 → 用户确认 → 后端二次校验 → 落库」

---

## 1. 技术栈

| 组件 | 选型 | 说明 |
| --- | --- | --- |
| Web 框架 | FastAPI 0.143 | 自动 OpenAPI 文档、Pydantic v2 校验 |
| ORM | SQLAlchemy 2.0（同步） | `Mapped` 类型注解风格 |
| 数据库 | MySQL 8.x（utf8mb4） | 驱动 PyMySQL；连接池 `pool_pre_ping` + 回收 |
| 校验/配置 | Pydantic v2 + pydantic-settings | `.env` 驱动 |
| 认证 | PyJWT（HS256）+ bcrypt | JSON 登录，返回 Bearer Token |
| AI | OpenAI 兼容协议（DeepSeek 等） | `openai` SDK 工具调用；无 Key 自动规则兜底 |

---

## 2. 目录结构

```
后端/
├── app/
│   ├── main.py                 # 应用入口：lifespan、CORS、全局异常、/health
│   ├── seed.py                 # 演示数据（4 用户 / 6 供应商 / 10 商品 / 3 仓库 / 6 采购单 / 3 物流单）
│   ├── core/                   # 配置、数据库、异常、安全、工具函数、日志
│   ├── models/                 # 17 张表的 ORM 模型 + 枚举
│   ├── schemas/                # 请求/响应模型（含统一分页 Page[T]）
│   ├── services/               # 业务逻辑：库存、采购、物流、调拨、工作台、主数据、用户、AI
│   │   └── ai/                 # Agent：tools（7 个工具）、runner（LLM+规则）、prompts、reports、knowledge（RAG）
│   ├── api/
│   │   ├── deps.py             # 当前用户、角色依赖、分页依赖
│   │   └── v1/                 # 11 个路由模块
│   └── data/knowledge/         # 4 篇制度文档（供 retrieve_business_knowledge 检索）
├── scripts/
│   ├── init_mysql.py           # 创建数据库（utf8mb4）
│   ├── seed.py                 # 建表 / 重置 / 写入演示数据
│   └── smoke_test.py           # 全链路自测（32 项断言）
├── tests/                      # pytest 用例（业务规则单测 + 接口测试）
├── requirements.txt
├── .env / .env.example
└── run.py                      # 开发启动脚本
```

---

## 3. 快速开始

### 3.1 安装依赖

```bash
pip install -r requirements.txt
```

### 3.2 配置数据库连接

复制 `.env.example` 为 `.env`，按实际环境修改：

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=1234
DB_NAME=supplymind
DB_CHARSET=utf8mb4
```

> 也可以直接填 `DATABASE_URL=mysql+pymysql://user:pass@host:3306/db?charset=utf8mb4`，此时优先生效。

### 3.3 创建数据库

```bash
python scripts/init_mysql.py
```

该脚本会创建 `supplymind` 库（`utf8mb4 / utf8mb4_general_ci`）并打印最终连接串。

### 3.4 启动服务

```bash
python run.py            # 8000 被占用时自动用 8001
# 或
uvicorn app.main:app --reload --port 8000
```

首次启动会自动建表（`AUTO_CREATE_TABLES`）。`AUTO_SEED_DEMO_DATA` **默认关闭**：
空库不会再被自动灌入 `app/seed.py` 的演示数据，数据请用 3.6 的脚本显式导入。
启动日志会打印连接的数据库、MySQL 版本、AI 运行模式。

### 3.5 访问

| 地址 | 说明 |
| --- | --- |
| <http://127.0.0.1:8000/docs> | Swagger UI |
| <http://127.0.0.1:8000/redoc> | ReDoc |
| <http://127.0.0.1:8000/health> | 健康检查（含数据库连通性与 AI 模式） |

登录示例：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
```

返回 `access_token` 后，请求头带 `Authorization: Bearer <token>`。

### 3.6 用 SQL 文件导入数据（推荐做法）

仓库根目录有两份 SQL：`schema-mysql.sql`（建库建表）和 `mock-data(1).sql`（演示数据，只含 INSERT）。
**不要让后端去猜数据在哪**，直接用脚本灌进 `.env` 里 `DB_NAME` 指定的库：

```bash
cd 后端
python scripts/import_sql.py --check     # 只看 SQL 文件里各表会写多少行，不连库
python scripts/import_sql.py --yes       # 备份现有库 + 执行建表脚本 + 灌数据
python scripts/import_sql.py --yes --data-only   # 只灌数据，保留现有表结构
```

脚本会：先整库备份到 `<DB_NAME>_backup_<时间戳>` → 执行 `schema-mysql.sql` → 执行 `mock-data(1).sql`
→ 逐表核对行数（和 SQL 文件声明的行数对比，不一致会标 `!!`）。

> 注意：`mock-data(1).sql` 只含 INSERT，本身不带 `CREATE DATABASE` / `USE`。
> 如果用 Navicat/DataGrip 手动执行，数据会进**当前选中的那个库**——
> 选错了库（比如选到 `shizhan`）就会出现「SQL 导入成功，但页面还是老数据」。

### 3.7 页面数据和数据库对不上时，先查这三处

| 检查 | 怎么做 | 典型现象 |
| --- | --- | --- |
| ① 后端连的是哪个库 | 打开 <http://127.0.0.1:8000/health>，看 `database` 字段 | 你往 `shizhan` 灌了数据，但这里是 `.../supplymind` |
| ② 这个库里有几行 | `python scripts/import_sql.py --check` 对比行数，或用 Navicat 直接查 | 库里是 8 条供应商，页面也是 8 条，但你导入的是 15 条那份数据 |
| ③ 后端有没有「自动灌演示数据」 | 启动日志里有 `演示数据写入完成` 就说明被 `AUTO_SEED_DEMO_DATA` 灌了一套 `app/seed.py` 的数据 | 供应商变成「深圳市恒通电子」这类硬件品类，和 SQL 文件完全不是一套 |

---

## 4. 演示账号

| 账号 | 密码 | 角色 | 权限范围 |
| --- | --- | --- | --- |
| `admin` | `admin123` | admin 系统管理员 | 全部功能 |
| `purchaser` | `purchaser123` | purchaser 采购员 | 采购单、供应商、商品/仓库维护、AI 草稿生成 |
| `warehouse` | `warehouse123` | warehouse 仓管 | 收货入库、物流节点、库存调拨 |
| `viewer` | `viewer123` | viewer 只读 | 仅查询与 AI 只读问答 |

角色权限在服务层与依赖层双重校验（无权限统一返回 403）。

---

## 5. 核心业务规则（实现位置）

| 规则 | 实现 |
| --- | --- |
| 采购状态流：草稿 → 待审批 → 已审批 → 部分收货 → 已完成；驳回/取消为结束分支 | `app/services/purchase_service.py` |
| **创建人不能审批自己的订单** | `approve_order()` → 400 `SELF_APPROVAL_FORBIDDEN` |
| **收货数量不能超过剩余未收数量** | `receive_order()` → 400 `RECEIPT_EXCEEDS_REMAINING` |
| **库存更新与流水写入必须在同一事务内** | `apply_stock_change()` 只 `flush`，由端点统一 `commit()` |
| 库存预警：库存 `0` 缺货 / `< 安全库存` 低库存 / 其他正常 | `app/services/rules.py::stock_status_of()` |
| 补货量 `= max(0, 安全库存 - 可用库存 - 已审批未收货数量)` | `app/services/rules.py::compute_replenishment()` |
| 供应商准时交付率（仅统计已完成且有计划到货时间的订单，样本不足显示「数据不足」） | `master_data_service.supplier_statistics()` |
| 物流超预计到达未送达 → 标记延迟 | `logistics_service.refresh_delays()` |
| 调拨校验调出库存，成功则一次扣减 + 增加并生成双向流水 | `transfer_service.create_transfer()` |
| AI 白名单工具、只读边界、工具调用留痕、草稿确认 | `app/services/ai/tools.py`、`runner.py`、`ai_service.confirm_task()` |

统一错误响应：

```json
{ "code": "SELF_APPROVAL_FORBIDDEN", "message": "创建人不能审批自己创建的采购订单，请由其他审批人处理", "detail": null }
```

统一分页响应：`{ "items": [...], "total": 42, "page": 1, "page_size": 20, "pages": 3 }`

---

## 6. 接口清单

所有业务接口前缀 `/api/v1`。

### 认证与用户（`/auth`、`/users`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 登录（JSON 提交，返回 JWT） |
| GET | `/auth/me` | 当前登录用户 |
| POST | `/auth/password` | 修改密码 |
| POST | `/auth/logout` | 退出登录（前端丢弃令牌） |
| GET | `/users` | 用户列表 |
| POST | `/users` | 新增用户 |
| GET | `/users/roles` | 角色字典 |
| GET | `/users/{user_id}` | 用户详情 |
| PUT | `/users/{user_id}` | 修改用户 |
| POST | `/users/{user_id}/reset-password` | 重置密码 |

### 工作台（`/dashboard`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dashboard/overview` | 工作台总览（KPI + 趋势 + 待办 + 预警 + AI 洞察） |
| GET | `/dashboard/kpi` | KPI 指标 |
| GET | `/dashboard/trend` | 近 N 天采购趋势 |
| GET | `/dashboard/todos` | 我的待办（待审批 / 待收货 / 物流延迟） |
| GET | `/dashboard/alerts` | 风险预警（缺货 / 低库存 / 物流延迟） |
| GET | `/dashboard/ai-insights` | AI 洞察（规则版） |

### 供应商（`/suppliers`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/suppliers` | 供应商列表 |
| POST | `/suppliers` | 新增供应商 |
| GET | `/suppliers/status-options` | 供应商状态字典 |
| GET | `/suppliers/{supplier_id}` | 供应商详情（含履约统计） |
| PUT | `/suppliers/{supplier_id}` | 修改供应商 |
| PATCH | `/suppliers/{supplier_id}/status` | 启用/停用供应商 |
| GET | `/suppliers/{supplier_id}/statistics` | 供应商履约统计（准时交付率） |
| GET | `/suppliers/{supplier_id}/orders` | 供应商历史采购单 |

### 商品与仓库（`/products`、`/warehouses`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/products` | 商品列表（含总库存与库存状态） |
| POST | `/products` | 新增商品 |
| GET | `/products/{product_id}` | 商品详情 |
| PUT | `/products/{product_id}` | 修改商品 |
| PATCH | `/products/{product_id}/status` | 启用/停用商品 |
| GET | `/products/{product_id}/inventory` | 商品在各仓库的库存分布 |
| GET | `/products/{product_id}/transactions` | 商品的库存流水 |
| GET | `/warehouses` | 仓库列表 |
| POST | `/warehouses` | 新增仓库 |
| GET | `/warehouses/options` | 仓库下拉选项 |
| GET | `/warehouses/{warehouse_id}` | 仓库详情 |
| PUT | `/warehouses/{warehouse_id}` | 修改仓库 |
| PATCH | `/warehouses/{warehouse_id}/status` | 启用/停用仓库 |
| GET | `/warehouses/{warehouse_id}/stock` | 仓库库存明细 |

### 库存（`/inventory`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/inventory` | 库存总览（按商品聚合各仓库） |
| GET | `/inventory/summary` | 库存统计卡片 |
| GET | `/inventory/alerts` | 库存预警（缺货优先，按缺口排序） |
| GET | `/inventory/transactions` | 库存流水 |
| GET | `/inventory/replenishment/{product_id}` | 单个商品的补货建议 |
| POST | `/inventory/replenishment` | 按请求体计算补货建议 |

### 采购订单（`/purchase-orders`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/purchase-orders` | 采购订单列表 |
| POST | `/purchase-orders` | 创建采购订单（草稿） |
| GET | `/purchase-orders/status-options` | 采购订单状态字典 |
| GET | `/purchase-orders/{order_id}` | 采购订单详情 |
| PUT | `/purchase-orders/{order_id}` | 修改采购订单（仅草稿） |
| POST | `/purchase-orders/{order_id}/submit` | 提交审批 |
| POST | `/purchase-orders/{order_id}/approve` | 审批通过（创建人不能审批自己的订单） |
| POST | `/purchase-orders/{order_id}/reject` | 驳回 |
| POST | `/purchase-orders/{order_id}/cancel` | 取消 |
| POST | `/purchase-orders/{order_id}/receive` | 收货入库（库存与流水同一事务） |
| GET | `/purchase-orders/{order_id}/receipts` | 收货记录 |

### 物流（`/logistics`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/logistics` | 物流单列表（可按 `only_delayed` 过滤） |
| POST | `/logistics` | 创建物流单 |
| GET | `/logistics/status-options` | 物流状态字典 |
| POST | `/logistics/refresh-delays` | 批量刷新延迟标记 |
| GET | `/logistics/{logistics_id}` | 物流单详情（含轨迹） |
| POST | `/logistics/{logistics_id}/events` | 新增物流节点（模拟更新） |

### 调拨（`/stock-transfers`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/stock-transfers` | 调拨记录列表 |
| POST | `/stock-transfers` | 创建调拨（扣减调出仓 + 增加调入仓 + 双向流水，同一事务） |
| GET | `/stock-transfers/{transfer_id}` | 调拨详情 |

### AI 智能中心（`/ai`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/ai/capabilities` | AI 能力与运行模式（`llm` / `rule`） |
| GET | `/ai/tools` | 当前用户可用的白名单工具 |
| GET | `/ai/analysis-capabilities` | 分析能力清单 |
| POST | `/ai/chat` | 与主 Agent 对话（支持工具调用与草稿确认） |
| GET | `/ai/conversations` | 会话列表 |
| POST | `/ai/conversations` | 新建会话 |
| GET | `/ai/conversations/{conversation_id}` | 会话详情（含消息） |
| PATCH | `/ai/conversations/{conversation_id}` | 重命名会话 |
| DELETE | `/ai/conversations/{conversation_id}` | 删除会话 |
| GET | `/ai/tasks` | Agent 任务列表 |
| GET | `/ai/tasks/{task_id}` | 任务详情（含工具调用记录） |
| POST | `/ai/tasks/{task_id}/confirm` | 确认 AI 生成的采购草稿（后端二次校验后落库） |
| POST | `/ai/tasks/{task_id}/cancel` | 取消任务 |
| GET | `/ai/reports` | 分析报告列表 |
| GET | `/ai/reports/{report_id}` | 报告详情 |
| POST | `/ai/analyze/inventory` | 场景一：库存分析 + 补货建议 |
| POST | `/ai/analyze/purchase` | 场景二：采购辅助分析 |
| POST | `/ai/analyze/logistics/{logistics_id}` | 场景三：物流异常分析 |
| POST | `/ai/analyze/supplier/{supplier_id}` | 附加：供应商风险分析 |

---

## 7. AI 智能中心

### 7.1 架构

```
用户消息 → ai_service.chat()
             ├─ 记录 user 消息 + 创建 AITask
             ├─ runner.run_agent()
             │    ├─ 有 OPENAI_API_KEY → LLM 工具循环（最多 LLM_MAX_TOOL_ROUNDS 轮）
             │    └─ 无 Key / 失败    → 规则引擎兜底
             ├─ 记录 assistant 消息（含工具调用明细）
             └─ 有草稿卡片 → 任务置 awaiting_confirmation；否则 completed
```

### 7.2 七个白名单工具

| 工具 | 说明 | 权限 |
| --- | --- | --- |
| `query_inventory` | 查询库存与预警 | 全员 |
| `query_purchase_orders` | 查询采购订单 | 全员 |
| `query_supplier` | 查询供应商与履约统计 | 除仓管外 |
| `query_logistics` | 查询物流单与轨迹 | 全员 |
| `calculate_replenishment` | 按公式计算建议采购量 | 全员 |
| `create_purchase_draft` | 生成采购草稿卡片（**不写库**） | admin / purchaser |
| `retrieve_business_knowledge` | 检索 4 篇制度文档（RAG） | 全员 |

每次调用都会写入 `ai_tasks.tool_calls`：工具名、参数摘要、状态（success/failed/rejected）、耗时（ms）、错误信息。

### 7.3 回答结构

统一五段式：`### 结论` → `### 数据依据` → `### 原因分析` → `### 建议动作` → `### 可执行操作`。无销售历史时明确写「数据不足」，不编造需求预测。

### 7.4 三个必备场景演示路径

**场景一 · 库存分析与补货**

1. `GET /api/v1/inventory/alerts` 找到缺货商品（演示数据中的 `P007 ABS 塑料外壳`，三仓库存为 0）
2. `POST /api/v1/ai/chat`，body `{"content": "ABS 塑料外壳库存不够了，算一下要补多少，并生成采购草稿"}`
3. 返回五段式回答 + `confirmation` 卡片，任务状态 `awaiting_confirmation`
4. `POST /api/v1/ai/tasks/{task_id}/confirm` → 后端二次校验 → 生成 `PO...` 草稿
5. 后续：提交审批 → 他人审批 → 收货入库

**场景二 · 采购辅助**

`POST /api/v1/ai/analyze/purchase` 输出待审批、部分收货、异常供应商的采购建议报告并落库（`ai_reports`）。

**场景三 · 物流异常分析**

1. `POST /api/v1/logistics/refresh-delays` 批量标记延迟
2. `GET /api/v1/logistics?only_delayed=true` 取延迟单
3. `POST /api/v1/ai/analyze/logistics/{logistics_id}` → 生成异常报告（原因、影响订单、处理建议）

---

## 8. 数据模型（17 张表）

`users`、`suppliers`、`products`、`warehouses`、`warehouse_stock`、`inventory_transactions`、`purchase_orders`、`purchase_order_items`、`logistics_orders`、`logistics_events`、`stock_transfers`、`stock_transfer_items`、`ai_conversations`、`ai_messages`、`ai_tasks`、`ai_reports`、`operation_logs`。

- 时间统一存储为 **naive UTC**
- 库存流水 `quantity` 带符号（入库为正、出库为负），并记录 `balance_after` 便于审计
- 枚举以字符串落库，跨库可迁移

---

## 9. 测试与运维脚本

```bash
python scripts/smoke_test.py      # 全链路自测：会重置数据库并重新写入演示数据
python scripts/seed.py --reset    # 手动重置数据
python scripts/init_mysql.py      # 仅建库

pip install pytest                # 首次需要
python -m pytest tests -q         # 单元测试 + 接口测试（共 32 项，不重置数据）
```

`smoke_test.py` 覆盖 32 项断言：健康检查、登录鉴权、工作台与库存预警、AI 五段式回复与草稿确认落库、采购闭环（提交 → 自审批被拒 → 他人审批 → 部分收货 → 超量收货被拒 → 库存增量 → 收货记录 → 流水）、物流延迟刷新与异常报告、调拨与角色权限。

`tests/` 下分两类用例：

- `tests/test_rules.py`：库存状态判定、补货公式、延迟天数、金额计算等纯函数单测（不需要数据库）
- `tests/test_api.py`：健康检查、鉴权与 401/403、分页结构、库存预警口径、补货公式一致性、创建人不能自审批、超量收货被拒、AI 五段式回复与工具权限过滤、物流延迟刷新、工作台总览结构

---

## 10. 常见问题

| 现象 | 处理 |
| --- | --- |
| `Error 1045 Access denied` | 检查 `.env` 中 `DB_USER` / `DB_PASSWORD` |
| 启动报「数据库不可用」 | 先执行 `python scripts/init_mysql.py` 建库，确认 MySQL 服务已启动 |
| 中文乱码 | 确认库与表为 `utf8mb4`；Windows 控制台先执行 `chcp 65001` |
| 端口被占用 | 用 `python run.py`，会自动切换到 8001 |
| **页面显示的数据不是 SQL 文件里的那份** | 99% 是「数据灌进了别的库」。看 `/health` 的 `database`；按 3.6 用 `scripts/import_sql.py` 重新导入到 `DB_NAME` 指定的库 |
| 启动日志出现「演示数据写入完成」，但你没手动灌过数据 | `.env` 里 `AUTO_SEED_DEMO_DATA=true`；改成 `false` 后重启，再按 3.6 导入 SQL |
| AI 一直是 `rule` 模式 | 未配置 `OPENAI_API_KEY`；填入 DeepSeek/OpenAI Key 后重启即切换为 `llm` |

---

## 11. 环境变量速查

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 空 | 非空时优先于下方分项配置 |
| `DB_HOST` / `DB_PORT` | 127.0.0.1 / 3306 | MySQL 地址 |
| `DB_USER` / `DB_PASSWORD` | root / 1234 | MySQL 账号 |
| `DB_NAME` / `DB_CHARSET` | supplymind / utf8mb4 | 库名与字符集 |
| `SECRET_KEY` | 内置默认值 | JWT 签名密钥，生产必须修改 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 720 | 令牌有效期 |
| `OPENAI_API_KEY` | 空 | 为空则启用规则引擎兜底 |
| `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容地址 |
| `OPENAI_MODEL` | `deepseek-chat` | 模型名 |
| `AUTO_CREATE_TABLES` | true | 启动时自动建表 |
| `AUTO_SEED_DEMO_DATA` | false | 空库时自动写入 `app/seed.py` 演示数据（建议关掉，改用 `scripts/import_sql.py`） |
| `SUPPLIER_MIN_SAMPLE` | 3 | 准时交付率最小样本量 |
| `DASHBOARD_TREND_DAYS` | 7 | 工作台趋势天数 |
