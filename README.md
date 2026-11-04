# SupplyMind｜AI 智能供应链管理平台

前端（React + TS + Vite）、后端（FastAPI + SQLAlchemy）、数据库（MySQL 8.4）三件套合并到同一个 PyCharm 工作区，
一个根目录、一次打开、两个运行配置就能跑起来。

- 后端接口文档：<http://127.0.0.1:8000/docs>
- 前端页面：<http://127.0.0.1:5273>
- 数据库：MySQL `127.0.0.1:3306`，库名 **`supplymind`**

> 本目录由别人电脑上的 `02_项目源码`（前端 `supplymind-web` + 后端 `后端\后端` + 根目录的 SQL）
> 重新归置而成。**桌面上的原始目录没有动**，可以留作备份，确认没问题后再自己清理。

---

## 一、目录结构

```text
SupplyMind/                        ← PyCharm 项目根（本项目）
├─ .idea/                          PyCharm 项目配置 + 两个运行配置
├─ SupplyMind.iml                  模块（解释器、源码根、排除 node_modules）
├─ start-all.cmd                   一键启动 MySQL → 后端 → 前端，并打开浏览器
├─ stop-all.cmd                    一键停掉 8000 / 5273（可选停 MySQL）
├─ .gitignore                      前端 + 后端统一的忽略规则
├─ README.md                       本文件
│
├─ backend/                        ★ FastAPI 后端
│   ├─ app/                        应用代码
│   │   ├─ api/                    路由（v1 下各业务模块，共 92 个端点）
│   │   ├─ core/                   配置、数据库、鉴权、ID 生成
│   │   ├─ models/                 SQLAlchemy 模型（23 张表）
│   │   ├─ schemas/                Pydantic 出入参
│   │   ├─ services/               业务逻辑（含 AI Agent / 工具调用）
│   │   └─ main.py                 应用入口（含 startup 钩子）
│   ├─ scripts/                    建表、导数据、冒烟测试等运维脚本
│   ├─ tests/                      pytest 用例
│   ├─ run.py                      本地启动脚本（端口 8000，会自动拉起 MySQL）
│   ├─ requirements.txt            Python 依赖
│   ├─ .env                        环境变量（含数据库密码，已被 .gitignore 忽略）
│   ├─ .env.example                环境变量模板，提交用这个
│   └─ schema-mysql.sql            建表脚本（与 database/ 下同名文件内容一致）
│
├─ frontend/                       ★ React 前端
│   ├─ src/
│   │   ├─ pages/                  dashboard / purchase / catalog / ai / Settings
│   │   ├─ layout/                 布局、侧边导航、全局 AI 抽屉
│   │   ├─ components/             PageHeader、StatusTag、EChart、Magic UI 动效
│   │   ├─ services/               api.ts（唯一出口）/ realApi.ts / mockApi.ts / ai.ts
│   │   ├─ mock/                   mock 模式的种子数据与 Mock Agent
│   │   └─ types.ts                ★ 前后端契约（领域模型）
│   ├─ vite.config.ts              端口 5273，/api 代理到 127.0.0.1:8000
│   ├─ package.json / pnpm-lock.yaml / .npmrc / pnpm-workspace.yaml
│   ├─ dify/                      Dify「供应商报价评估」应用导出 + 导入手册（详见该目录 README）
│
   └─ start-dev.cmd               前端单独启动（自带 Node 路径兜底）
│
└─ database/                       ★ 数据库资产
    ├─ schema-mysql.sql            建表脚本（19 张业务表 + 视图）
    ├─ supplymind_demo_data.sql    演示数据（约 600 KB INSERT）
    └─ README.md                   建库、导入、连接配置说明
```

---

## 二、本机环境（已核对过，可直接跑）

| 项 | 版本 / 位置 | 状态 |
|---|---|---|
| Python | `F:\HeiMaChengxuyuan\anaconda\python.exe`（3.14.6） | ✅ PyCharm 已注册该解释器，项目已指向它 |
| Python 依赖 | fastapi 0.143.0、uvicorn 0.40.0、SQLAlchemy 2.0.51、PyMySQL、pydantic 2.14.1、bcrypt 5.0.0、PyJWT、openai | ✅ 与 `requirements.txt` 要求一致，**无需再装** |
| Node / pnpm | Node 22.22.2 / pnpm 12.15.0 | ✅ 前端依赖已 `pnpm install` 完成 |
| MySQL | `F:\HeiMaChengxuyuan\mysql-8.4.5-winx64`，`3306` | ✅ 库 `supplymind` 已存在：23 张表、151 条供应商 |

如果你换机器、或想用独立虚拟环境：

```powershell
cd backend
python -m venv ..\.venv
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 然后在 PyCharm: Settings → Python Interpreter → 添加 ..\.venv\Scripts\python.exe
```

---

## 三、怎么启动（三种方式，任选一种）

### 方式 1：双击 `start-all.cmd`（最省事）

按顺序检查 3306 → 8000 → 5273，缺哪个起哪个，最后自动打开 <http://127.0.0.1:5273>。
关掉服务用 `stop-all.cmd`。

### 方式 2：PyCharm 右上角运行配置

项目里已经配好两个：

- **后端 FastAPI (8000)** —— 跑 `backend/run.py`，工作目录 `backend`
- **前端 dev (pnpm)** —— 跑 `frontend` 的 `pnpm dev`

先点后端、再点前端即可（PyCharm 2024+ 还可以在 Services 面板里同时跑）。
MySQL 没开也没关系，`run.py` 会去 `F:\HeiMaChengxuyuan\mysql-8.4.5-winx64` 把 mysqld 拉起来。

### 方式 3：手动命令行

```powershell
# 1) MySQL（服务方式启动不了的话，直接拉 mysqld）
F:\HeiMaChengxuyuan\mysql-8.4.5-winx64\bin\mysqld.exe --datadir=F:\HeiMaChengxuyuan\mysql-8.4.5-winx64\data --port=3306

# 2) 后端
cd backend
python run.py            # http://127.0.0.1:8000/docs

# 3) 前端（另开一个终端）
cd frontend
pnpm dev                 # http://127.0.0.1:5273
```

### 演示账号

| 账号 | 密码 | 角色 |
|---|---|---|
| `gm` | `123456` | 总经理（可审批） |
| `sales01` | `123456` | 销售 / 采购 |
| `sales02` | `123456` | 销售 / 采购 |

---

## 四、前后端是怎么连上的

- 前端默认走**真实后端**（`VITE_API_MODE` 不设置就是 `real`）；
- `vite.config.ts` 里把 `/api` 代理到 `http://127.0.0.1:8000`，同源、不涉及 CORS；
- 想完全脱离后端演示：在 `frontend/.env.local` 写 `VITE_API_MODE=mock`，重启 `pnpm dev`（数据走 localStorage）。

数据库相关的建库 / 导入 / 连接说明见 [`database/README.md`](database/README.md)。

Dify AI 助手（右下角小机器人）的应用导出与导入说明见 [`frontend/dify/README`](frontend/dify/README)。

---

## 五、Dify AI 助手（可选接入）

右下角「AI 小助手」对接的是一个外部 Dify 工作流应用（「供应商报价评估」），不是项目内部代码。仓库里只带了它的**应用导出文件**和**对接代码**，没有密钥：

- `frontend/dify/supplier-quote-eval.dsl.yml`：把此文件导入你自己的 Dify 即可重建该应用（**不含密钥，可提交**）
- `backend/app/api/v1/dify.py` + 前端 `src/services/aiAssistant.ts`：对接代码，功能的一部分，必须提交
- `backend/.env` 里的 `DIFY_API_BASE` / `DIFY_API_KEY`：密钥，**已被 `.gitignore` 排除，不提交**

新仓库默认 `DIFY_ENABLED=false`（原 DIFY_API_BASE 指向原作者电脑上的虚拟机，本机连不上会卡 60 秒超时）。要真正启用：

1. 用 `frontend/dify/supplier-quote-eval.dsl.yml` 在你自己的 Dify 导入并发布，拿到 API Key；
2. 填进 `backend/.env` 的 `DIFY_API_BASE` / `DIFY_API_KEY`，把 `DIFY_ENABLED` 改回 `true`，重启后端。

不接 Dify 也完全不影响其它功能——此时 AI 小助手走前端本地降级逻辑。

---

## 六、这次归置改了什么（相对你拷过来的原始目录）

| 位置 | 处理 |
|---|---|
| `backend/` | 从 `后端\后端` 拷入；剔除 `__pycache__`、`*.log`、`*.bak`、`pytest-cache-files-*`、旧 `.idea` |
| `frontend/` | 从 `supplymind-web` 拷入；不拷 `node_modules`/`dist`/`.tmp`/`.shots`/旧 `.idea`/`web.log`，依赖在新位置重装 |
| `database/` | **新增**，放入 `schema-mysql.sql` 与 `supplymind_demo_data.sql` |
| `start-all.cmd` / `stop-all.cmd` | **新增在根目录**；原前端目录里的同名脚本写死了 `D:\supplymind-api`、`D:\supplymind-web`，已删除 |
| `frontend/package.json` | `name` 从 `" -web"` 改为 `"supplymind-web"` |
| `frontend/pnpm-workspace.yaml` | `allowBuilds.esbuild` 原为占位文本 `set this to true or false`，改为 `true`，消除 `ERR_PNPM_IGNORED_BUILDS` |
| `backend/.env` | `DIFY_ENABLED=true → false`：原配置指向别人电脑的虚拟机 `192.168.88.100`，本机连不上会让 AI 小助手卡 60 秒超时。要用时填自己的 Dify 地址再打开 |
| `.gitignore` | **新增根级**，统一忽略 Python / Node / IDE 产物 |
| `.idea/` | **新增**，模块 + 解释器 + 两个运行配置 |

已验证：后端 `/health` 返回 `database_ok: true`（MySQL 8.4.5）、`gm/123456` 登录返回 token；
前端 `pnpm build` 通过（tsc 无类型错误），dev server 起来后经 `/api` 代理登录成功。

---

## 七、提交 Git 前的注意点

`.gitignore` 已经把下面这些排除了，正常 `git add .` 不会带进去：

- `node_modules/`、`dist/`、`.tmp/`、`.vite/`
- `__pycache__/`、`.venv/`、`*.log`、`.pytest_cache/`、`.ruff_cache/`
- **`backend/.env`**（里面有数据库密码和 Dify key）

`.env` 不进仓库，但队友 clone 下来要能跑，所以：

```powershell
copy backend\.env.example backend\.env   # 队友拿到后改成自己的密码
```

`.idea/` 我只忽略了 `workspace.xml` 等个人文件，模块与运行配置是提交的
（这样队友打开就能直接用那两个运行配置）。如果老师要求不提交 `.idea`，把 `.gitignore` 里对应行放开即可。

---

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| PyCharm 里 `pnpm` 找不到 | IDE 比 Node 先启动，没继承新 PATH：File → Exit 彻底退出再打开；或直接用内置终端跑 `frontend\start-dev.cmd` |
| 端口 8000 被占 | `run.py` 会先 taskkill 占用者再接管；不想让它杀进程就 `python run.py -NoKill` |
| 前端能开但列表全空 | 后端没起或 8000 不是本项目（代理 404）；先访问 <http://127.0.0.1:8000/health> 看 `database_ok` |
| 页面数据跟库里不一致 | `AUTO_SEED_DEMO_DATA=false`，空库不会自动灌数据；按 `database/README.md` 导 `supplymind_demo_data.sql` |
| AI 小助手一直转圈 | `.env` 里 `DIFY_ENABLED=false` 时它走本地降级；要接 Dify 才改地址 |
| `ERR_PNPM_IGNORED_BUILDS` | 已修（`pnpm-workspace.yaml` 的 `allowBuilds`）；再遇到就 `pnpm approve-builds` 选 esbuild |
