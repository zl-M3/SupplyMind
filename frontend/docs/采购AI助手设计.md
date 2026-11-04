# 采购管理模块 AI 助手设计

> 范围：只对 **采购管理** 一级入口（供应商管理 / 采购订单 / 物流跟踪）植入 AI 助手。
> 依据：《  MVP 模块精简版产品规划 v1.1》+ 现有前端 ` -web` 的实体与接口。
> 一句话定位：**采购员的副驾，不是采购员的替代品。** 它负责查、算、起草、盯梢、解释；决定权（审批、收货、停用供应商）永远在人手里。

---

## 一、先把边界钉死

范围收窄的最大价值不是"少做"，而是**能把权责写清楚**。下面这张表是整个设计的地基。

### 1.1 数据边界

| 域 | 表 | Agent 权限 | 说明 |
|---|---|---|---|
| **采购域** | `suppliers`、`supplier_quotes`、`purchase_orders`、`purchase_order_items`、`purchase_approvals`、`logistics_orders`、`logistics_events`、`purchase_followups` | 读 + **受限写** | 写仅限草稿、备注、提交审批 |
| **库存域** | `warehouse_stock`、`products`、`warehouses` | **只读** | 判断到货影响、算补货量必须看库存，但不能改 |
| **知识域** | `kb_documents`、`kb_chunks` | 只读 | 制度、合同、口径 |
| **AI 域** | `ai_conversations`、`ai_messages`、`ai_tool_calls`、`ai_tasks`、`ai_reports`、`agent_audit_log` | 读写 | 自己的痕迹自己记 |

> 为什么允许跨域只读：**不读库存的采购助手只会"催货"，不会"判断该不该催"。** 但跨域只读必须走服务端固定视图，不给 Agent 拼 SQL 的能力。

### 1.2 动作边界（这条比数据边界更重要）

| 动作 | Agent 能不能做 | 原因 |
|---|---|---|
| 生成/修改采购草稿 | ✅ 可以（草稿态） | 错了删掉就行，无副作用 |
| 提交审批 | ⚠️ 可以，但**必须二次确认** | 会进入审批流，影响他人 |
| 写跟进备注 / 建任务 | ✅ 可以 | 纯记录 |
| **审批通过 / 驳回** | ❌ 绝对不可以 | 制度上是人的判断权；且"创建人≠审批人" |
| **登记收货 / 改库存** | ❌ 不可以 | 一改库存就是资金与账实问题 |
| **停用供应商 / 改价** | ❌ 不可以 | 合同与商务决策 |
| **直接发消息给供应商** | ❌ 首期不可以 | 对外沟通必须人发，Agent 只起草文案 |

那张"创建人与审批人不能相同"的规则，在 AI 这里升级成了一句话：**Agent 不能既当起草人又当审批人，它连审批入口都不该有。**

---

## 二、六条工作流（不是六个 Agent）

### 2.1 为什么是"工作流"而不是"多 Agent"

PRD 明确写了不拆多个独立 Agent。工作流在这里的正确含义是：

> **工作流 = 固化下来的编排模板（子图）**，它规定"这类任务按什么顺序、用哪些工具、在哪一步停下来等人"。
> Agent 只有一个，它做的是**选工作流 + 填参数**；工作流内部不该由模型自由发挥的环节，全部是确定性节点。

这样设计有三个实际好处：

1. **工具数量可控**：每轮只挂当前工作流需要的 4～7 个工具，而不是把 19 个能力全塞给模型；
2. **可测试**：一条工作流一个评测集，改了一处能回归；
3. **可验收**：每条工作流有明确的产出物和人工确认点，能对着验收。

### 2.2 总览

| # | 工作流 | 触发入口 | 产出物 | 人工确认点 |
|---|---|---|---|---|
| **A1** | 建单助手（起草采购单） | 采购订单页 / 库存预警"去补货" / 对话 | 采购草稿 | ✅ 草稿确认卡片 |
| **A2** | 询价比价与供应商推荐 | 建单页"帮我选供应商" / 供应商页 | 比价对比表 + 推荐理由 | ✅ 选哪一个由人点 |
| **A3** | 待审批单审阅 | 工作台待办 / 订单详情 | 审阅意见（风险点清单） | — 只出意见，不改状态 |
| **B1** | 采购进度巡检与催办 | 定时（每日 9:00）/ 手动 | 待办清单 + 催办文案草稿 | ✅ 催办文案人发 |
| **B2** | 到货异常处置 | 物流详情"AI 分析" / 延迟告警 | 异常分析报告 + 处置方案 | ✅ 方案执行由人点 |
| **C1** | 供应商履约与风险 | 供应商详情 / 周报 | 风险报告 + 分级建议 | ✅ 降级/停用人决定 |
| **D1** | 制度与合同问答 | 全局 | 带引用的答案 | — 纯问答 |

按业务阶段分簇：**事前（A1/A2/A3）→ 事中（B1/B2）→ 事后（C1）→ 通用（D1）**。

---

## 三、工作流详设

> 每条都按"主链路 + 异常链路"写，符合五点稿里"必须准备三条流程"的要求。

### A1 · 建单助手

**触发**：用户在采购订单页说"帮我给华南仓补一下纸箱"；或从库存预警页点"去补货"（带 `productId` 上下文）。

**节点**：

```
① 载入上下文（productId / supplierId / 页面）
② 需求解析：品类、数量、到货时间、指定供应商？（缺关键槽位则澄清，一次只问一个）
③ 数量确定（确定性节点）：
     有 productId → calc_replenishment_need 按公式算
     无 productId → 澄清 + 库存快照
④ 供应商候选（调 A2 子流程，或用户指定则校验状态）
⑤ 单价确定：query_supplier_quotes 取最近成交价 / 报价
⑥ 组装草稿 → 前置校验（起订量、供应商是否停用、是否重复下单、金额阈值）
⑦ 生成确认卡片（商品 / 数量 / 单价 / 金额 / 依据）→ 人工确认
⑧ create_purchase_draft（写）→ 返回单号
⑨ 询问是否立即 submit_purchase_order（二次确认）
```

**工具**：`get_purchase_order_detail`（若基于旧单复制）、`calc_replenishment_need`、`query_suppliers`、`query_supplier_quotes`、`check_order_anomaly`、`create_purchase_draft`、`submit_purchase_order`

**异常链路**：

| 情况 | 处理 |
|---|---|
| 供应商已停用 | 不生成草稿，直接给出"该供应商已停用"和 2 个备选 |
| 数量低于起订量 | 提示起订量，建议取整到起订量倍数 |
| 检出重复下单（同商品同供应商 7 天内有未完成单） | 拦下，展示已有单号，让用户选择"合并到已有单"或"仍要新建" |
| 金额超审批阈值 | 草稿照建，但标注"该单需管理员审批" |
| 用户中途改数量 | 只重算受影响字段，不重跑全流程 |

**验收**：草稿字段正确率 100%（商品/数量/单价/供应商）；从"说一句话"到"草稿生成"≤ 3 轮对话。

---

### A2 · 询价比价与供应商推荐

**触发**：建单过程中选供应商；或"纸箱最近哪家便宜"。

**节点**：

```
① 明确标的（商品 + 数量 + 期望到货）
② 候选池：query_suppliers(品类=该商品品类, 状态=active)
③ 硬约束过滤（确定性）：资质有效期、品类授权、最小起订量 ≤ 数量
④ 逐家取数：query_supplier_quotes + get_supplier_profile（准时率/账期）
⑤ 打分（确定性，权重可配）：
     准时交付率 0.35 / 报价偏差 0.25 / 提前期满足度 0.25 / 账期与距离 0.15
⑥ 生成对比表：价格、预计到货、准时率、起订量、账期、风险提示
⑦ 推荐 Top1 + 说明"为什么不是第二家"
```

**工具**：`query_suppliers`、`get_supplier_profile`、`query_supplier_quotes`、`calc_supplier_score`、`calc_price_benchmark`

**关键设计**：**打分是代码算的，模型只解释。** 否则面试官一问"为什么推荐它"，答"模型觉得"就完了。

**异常链路**：硬约束后候选为空 → 明确回"该品类当前无合规供应商"，建议扩品类或走特采流程，**不允许模型编一个供应商出来**。

---

### A3 · 待审批单审阅

**触发**：审批人打开待审批的采购单；工作台待办点进来。

**节点**：

```
① get_purchase_order_detail
② 规则化体检（全部确定性）：
     创建人 = 当前审批人？→ 硬阻断
     单价 vs 历史成交价（calc_price_benchmark）→ 偏离 > 15% 标红
     数量 vs 近期同品类均值 → 异常放大标黄
     供应商状态 / 资质有效期
     是否与在途订单重复
③ 检索制度依据（retrieve_policy）：该金额档位需要谁批
④ 输出审阅意见：通过 / 有条件通过（附条件）/ 建议驳回（附理由）
```

**工具**：`get_purchase_order_detail`、`calc_price_benchmark`、`check_order_anomaly`、`get_supplier_profile`、`retrieve_policy`

**边界**：**只出意见，绝不改状态。** 审批按钮永远只在人手里。这条要在 UI 上说清楚——审阅意见旁写"AI 意见仅供参考"。

---

### B1 · 采购进度巡检与催办

**触发**：每日定时任务（后台）；或用户说"今天采购有什么要处理的"。

**节点**：

```
① 拉取三个集合：待审批积压 / 已审批未收货且临期或逾期 / 物流延迟
② 逐个判定优先级（确定性）：逾期天数 × 影响金额 × 供应商等级
③ 生成待办清单（按优先级排序）
④ 为每一条生成"下一步建议"：
     逾期 < 3 天 → 催办话术草稿
     逾期 ≥ 3 天 → 升级：走 B2 异常处置
     待审批超 24h → 提醒审批人
⑤ 产出：工作台卡片 + Agent 任务记录
```

**工具**：`query_purchase_orders`、`query_logistics`、`calc_delay_impact`、`add_followup_note`

**关键设计**：巡检结果是**确定性优先**的排序清单，模型只负责把每条写成一句人话。**不能让模型决定"哪单最急"**——那是业务规则。

**异常链路**：数据为空 → 明确说"今天没有需要处理的"，不要硬凑三条洞察。

---

### B2 · 到货异常处置

**触发**：物流详情页点"AI 分析异常"（带 `logisticsId`）；或 B1 升级。

**节点**：

```
① 取轨迹与关联采购单（query_logistics + get_purchase_order_detail）
② 归因（规则 + 轨迹节点）：承运商异常 / 天气 / 清关 / 供应商未发货 / 单证问题
③ 影响面计算（确定性，调库存只读）：
     受影响商品 → 当前可用 / 在途 / 已承诺
     缺口量 = 需求 − 可用 − 可及时到的在途
     在险金额 = 缺口量 × 单价；违约风险 = 受影响客户订单数 × 等级
④ 生成处置方案候选（3 个以内）：
     催办承运商 / 换供应商紧急补单 / 从其他库位调拨 / 与客户协商改期
     每题都要带：成本、时效、可行性
⑤ 检索制度与合同（retrieve_contract_clause）：是否可主张运费补偿、超期条款
⑥ 生成报告 → 存 ai_reports + ai_tasks
```

**工具**：`query_logistics`、`get_purchase_order_detail`、`query_inventory_snapshot`、`calc_delay_impact`、`query_supplier_quotes`、`retrieve_contract_clause`、`find_similar_cases`

**异常链路**：轨迹缺失或接口超时 → 明确标注"数据不足，无法归因"，只给"建议人工联系承运商"，**绝不编造原因**。这条对应现有 mock 里 `TASK-005` 那个失败任务的场景。

---

### C1 · 供应商履约与风险

**触发**：供应商详情页"AI 分析"；或周报定时。

**节点**：

```
① get_supplier_profile + 关联订单统计
② 指标计算（确定性，口径必须写清）：
     准时交付率 = 准时到达单数 / 已完成且有预计到货的单数
     样本 < 2 单 → 显示"数据不足"，不计算
     价格漂移 = 近 3 次报价 vs 品类基准
     集中度 = 该供应商采购额 / 品类总采购额
③ 检索历史案例（find_similar_cases）：这家以前出过什么事
④ 风险分级：正常 / 关注 / 预警，给出触发条件
⑤ 建议：维持 / 增加备选 / 降为备选 / 建议停用（需人工执行）
```

**工具**：`get_supplier_profile`、`query_purchase_orders`、`calc_supplier_score`、`calc_price_benchmark`、`find_similar_cases`

**关键设计**：指标口径必须来自知识库的"口径层"，不能各算各的。**同样的准时率在列表页和报告里必须是一个数**，否则一眼假。

---

### D1 · 制度与合同问答

**触发**：任何采购页面提问"多少金额需要谁审批""延迟赔偿怎么算"。

**节点**：

```
① 判定问题类型：制度 / 合同条款 / 口径 / 流程
② 检索（混合检索 + metadata 过滤 + 版本/有效期过滤）
③ 命中 ≥ 阈值 → 回答 + 引用（doc_id + 条款号 + 原文片段）
   命中不足 → 明确"未检索到相关规定，建议咨询采购负责人"，不给推测
④ 涉及实时数字的问题 → 转对应数据工具（查知识库不回答库存数量）
```

**工具**：`retrieve_policy`、`retrieve_contract_clause`

**关键设计**：**知识库只回答"规定是什么"，不回答"现在有多少"。** 混用是 RAG 项目最常见的翻车点。PRD 3.3 也是这个意思。

---

## 四、工具清单

### 4.1 设计原则

1. **窄接口**：一个工具只做一件事，参数和返回都有 schema；
2. **读写分离**：写工具单独一组，全部带幂等键，全部走前置拦截；
3. **算的不交给模型**：凡是"有唯一正确答案"的（数量、金额、评分、缺口），都是计算工具；
4. **暴露给模型的工具要裁剪**：19 个底层能力，但每轮只挂当前工作流的 4～7 个（见 4.3）。

### 4.2 设备（分四组，共 19 个）

#### 组一：查询（读，可缓存）

| # | 工具 | 入参 | 出参要点 | 现有代码 |
|---|---|---|---|---|
| 1 | `query_purchase_orders` | status[] / supplierId / keyword / 时间窗 | 订单列表 + 未收数量 + 逾期天数 | ✅ `purchaseOrderApi.list` |
| 2 | `get_purchase_order_detail` | poId | 明细 + 审批流 + 物流单 + 跟进记录 | ⚠️ 需补详情聚合 |
| 3 | `query_suppliers` | 品类 / 状态 / keyword | 供应商列表（无指标） | ✅ `supplierApi.list` |
| 4 | `get_supplier_profile` | supplierId | 资料 + 履约指标 + 合同摘要 | ✅ `supplierApi.get` + `metrics` |
| 5 | `query_supplier_quotes` | supplierId? / productId? / 最近 N 次 | 报价、账期、起订量、有效期 | ❌ 需新表 |
| 6 | `query_logistics` | logisticsId / poId / 仅延迟 | 轨迹节点 + ETA 偏差 | ✅ `logisticsApi.list` |
| 7 | `query_inventory_snapshot` | productId[] | 可用 / 在途 / 已承诺 / 安全库存 | ✅ `stockApi.overview` |

#### 组二：计算（纯函数，不落库，可单测）

| # | 工具 | 算法 | 现有代码 |
|---|---|---|---|
| 8 | `calc_replenishment_need` | `max(0, 安全库存 − 可用 − 已审批未收货)` | ✅ `stockApi.replenishment` |
| 9 | `calc_price_benchmark` | 近 N 次成交价的中位数 + 偏离度 | ❌ 新增 |
| 10 | `calc_supplier_score` | 硬约束过滤 + 四维加权（0.35/0.25/0.25/0.15） | ⚠️ 现只有准时率 |
| 11 | `calc_delay_impact` | 缺口量 × 单价、受影响订单数、违约风险 | ❌ 新增 |
| 12 | `check_order_anomaly` | 重复单 / 数量异常 / 单价异常 / 创建人=审批人 | ❌ 新增 |

#### 组三：写操作（3 个 + 1 个备注）

| # | 工具 | 幂等键 | 前置拦截 | 现有代码 |
|---|---|---|---|---|
| 13 | `create_purchase_draft` | `userId:payloadHash` | 供应商启用、商品存在、数量>0 | ✅ `purchaseOrderApi.create` |
| 14 | `update_purchase_draft` | `poId:version` | 仅 `status=draft` 可改 | ⚠️ 接口在，AI 未接 |
| 15 | `submit_purchase_order` | `poId:version` | 明细非空、**二次确认** | ✅ `purchaseOrderApi.submit` |
| 16 | `add_followup_note` | `poId:ts` | 只追加不改 | ❌ 需新表 |

#### 组四：知识（读，带引用）

| # | 工具 | 返回 | 现有代码 |
|---|---|---|---|
| 17 | `retrieve_policy` | 制度片段 + doc_id + 条款号 | ✅ `retrieve_business_knowledge`（Mock） |
| 18 | `retrieve_contract_clause` | 合同条款 + 供应商 + 有效期 | ❌ 需拆 |
| 19 | `find_similar_cases` | 历史处置案例 + 结果 | ❌ 新增 |

> 对照结论：现有 Mock 已实现 7 个工具中的 6 个，**真正缺的是"报价/价格基准/影响面/异常检测"这四类计算，以及合同与案例知识**。这也说明当前实现偏"能聊天"，离"能辅助决策"还差一层。

### 4.3 暴露策略：每个工作流只挂 4～7 个

| 工作流 | 暴露工具 | 数量 |
|---|---|---|
| A1 建单 | `calc_replenishment_need`、`query_suppliers`、`query_supplier_quotes`、`check_order_anomaly`、`create_purchase_draft`、`submit_purchase_order` | 6 |
| A2 询价 | `query_suppliers`、`get_supplier_profile`、`query_supplier_quotes`、`calc_supplier_score` | 4 |
| A3 审阅 | `get_purchase_order_detail`、`calc_price_benchmark`、`check_order_anomaly`、`retrieve_policy` | 4 |
| B1 巡检 | `query_purchase_orders`、`query_logistics`、`calc_delay_impact`、`add_followup_note` | 4 |
| B2 异常 | `query_logistics`、`get_purchase_order_detail`、`query_inventory_snapshot`、`calc_delay_impact`、`retrieve_contract_clause`、`find_similar_cases` | 6 |
| C1 供应商 | `get_supplier_profile`、`query_purchase_orders`、`calc_supplier_score`、`find_similar_cases` | 4 |
| D1 问答 | `retrieve_policy`、`retrieve_contract_clause` | 2 |

**这是工作流存在的核心理由**：不是模型能力不够，是一次给它 19 个选项它就会选错。

---

## 五、数据库

### 5.1 已有表（PRD 第 7 节，采购域直接用）

`users` · `suppliers` · `products` · `warehouses` · `warehouse_stock` · `purchase_orders` · `purchase_order_items` · `logistics_orders` · `logistics_events` · `inventory_transactions` · `ai_conversations` · `ai_messages` · `ai_tasks` · `operation_logs`

### 5.2 必须新增的表（6 张）

| 表 | 为什么必须有 | 关键字段 |
|---|---|---|
| **`supplier_quotes`** | 没有报价历史，"比价""价格基准"全是空谈，模型只能编 | `id`、`supplier_id`、`product_id`、`price`、`moq`、`lead_days`、`payment_terms`、`valid_from`、`valid_to`、`source` |
| **`purchase_approvals`** | 审批链路与驳回原因是 A3 和 C1 的依据 | `id`、`po_id`、`actor_id`、`action`(approve/reject)、`reason`、`at`、`amount_at_time` |
| **`purchase_followups`** | Agent 写的跟进备注要有地方落，且能追溯到订单 | `id`、`po_id`、`author_type`(human/agent)、`content`、`next_action_at`、`created_at` |
| **`ai_tool_calls`** | PRD 要求记录每次工具调用；这也是排查"Agent 为什么给出这个结论"的唯一证据 | `id`、`message_id`、`tool_name`、`params_digest`、`status`、`duration_ms`、`result_digest` |
| **`agent_audit_log`** | AI 的写操作必须与人的操作分开审计 | `id`、`actor_type`、`actor_id`、`action`、`target_type`、`target_id`、`before`、`after`、`idempotency_key`、`at` |
| **`kb_documents` / `kb_chunks`** | RAG 的元数据必须落库，否则做不了版本与有效期过滤 | 见第六节 |

### 5.3 建议的视图（把计算从 Agent 挪到数据库）

```sql
-- 采购进度：未收数量、逾期天数、影响金额
v_po_progress            (po_id, supplier_id, ordered_qty, received_qty,
                          remaining_qty, expected_arrival, overdue_days, amount)

-- 供应商准时率：分子分母都固化，杜绝口径漂移
v_supplier_ontime        (supplier_id, completed_cnt, ontime_cnt, ontime_rate,
                          sample_enough)     -- sample_enough = completed_cnt >= 2

-- 商品价格走势：近 N 次成交/报价
v_price_history          (product_id, supplier_id, price, quoted_at, source)
```

> 用视图而不是让 Agent 现算，理由很实在：**同一个指标出现在列表、报告、AI 回答里必须是同一个数**，否则用户一眼就能看出系统在瞎编。

### 5.4 索引

```sql
purchase_orders (supplier_id, status, expected_arrival)
purchase_order_items (product_id)
logistics_orders (po_id), logistics_orders (expected_arrival, status)
supplier_quotes (product_id, quoted_at DESC), (supplier_id, product_id)
purchase_followups (po_id, created_at DESC)
ai_tool_calls (message_id), agent_audit_log (target_type, target_id)
```

---

## 六、知识库

### 6.1 五层结构（按用途分，不按部门分）

| 层 | 内容 | 谁维护 | 更新频率 |
|---|---|---|---|
| **L1 制度层** | 采购审批规范（金额档位→审批人）、供应商准入/退出、比价与议价规则、紧急采购流程、付款与账期制度 | 采购负责人 | 季度 |
| **L2 合同层** | 框架协议、SLA、违约责任、价格调整条款、账期条款 | 法务 / 商务 | 签一份进一份 |
| **L3 口径层** | 指标定义：准时交付率怎么算、逾期天数从哪天起算、在途怎么认定、缺口怎么算 | 产品 + 数据 | 变更即更新 |
| **L4 案例层** | 历史异常处置记录：某供应商延期怎么处理、某品类涨价怎么应对、索赔成功案例 | 运营沉淀 | 每月 |
| **L5 品类层** | 品类知识、规格换算、可替代品关系（如 600×400 与 600×500 纸箱可替） | 商品 | 随主数据 |

> **L3 口径层是最容易被忽略、但最值钱的一层。** 它直接消灭"AI 说的准时率和列表上不一样"这类致命问题。

### 6.2 切分与元数据（决定 RAG 能不能用）

- **按条款切，不按字数切**：合同按"第 X 条"切；制度按"章节 + 条目"切。一条 chunk 一个可引用的最小单位；
- **每个 chunk 必带元数据**：

```json
{
  "doc_id": "CT-SUP-001",
  "doc_type": "contract",          // policy | contract | metric | case | catalog
  "supplier_id": "SUP-003",        // 合同/案例必填，制度为空
  "category": "劳保用品",
  "clause_no": "6.2",
  "version": "v2026.1",
  "effective_from": "2026-01-01",
  "effective_to": "2026-12-31",
  "source_url": "...",
  "owner": "法务部"
}
```

- **检索时强制带过滤**：`doc_type` + `supplier_id`（有上下文时）+ **有效期必须覆盖当前日期**。少了有效期过滤，就会引用一份已经失效的合同去回答赔偿问题——这是真实会发生的翻车。

### 6.3 检索策略

| 问题类型 | 策略 |
|---|---|
| 制度问答（"多少金额要谁批"） | 混合检索（BM25 + 向量）+ doc_type=policy |
| 合同条款（"这家延期怎么赔"） | metadata 过滤 supplier_id + 有效期 + doc_type=contract |
| 案例参考（"以前这种情况怎么处理"） | 向量检索 + 品类/异常类型过滤，按相似度 + 时效加权 |
| 口径查询（"准时率怎么算"） | 直接命中 L3，不走向量 |

### 6.4 引用与防幻觉（四条硬规则）

1. **必须引用到条款级**：`doc_id + clause_no + 原文片段`，前端可点开原文；
2. **检索不到就说没有**：返回"未检索到相关规定"，禁止推测。宁可答"不知道"；
3. **数字只从工具来**：金额、数量、天数、比率一律走计算工具，**知识库只提供规则文本**；
4. **引用必过校验**：出答案前扫描一遍引用的条款号是否真实存在于语料，命中率必须 100%。

---

## 七、State 与编排

```json
{
  "session_id": "...",
  "workflow": "A1_create_order",        // 路由结果
  "page_context": { "pageName": "采购订单", "targetId": null },

  "intent": { "domain": "purchase", "confidence": 0.91 },
  "slots": {
    "productId": "PRD-001", "qty": 300, "supplierId": null,
    "expectedArrival": "2026-11-08", "budget": null,
    "missing": ["supplierId"]
  },

  "facts": {
    "inventory": { "available": 120, "inTransit": 200, "safety": 800 },
    "quotes": [{ "supplierId": "SUP-001", "price": 4.2, "leadDays": 5 }],
    "priceBenchmark": { "median": 4.15, "deviation": 0.012 }
  },

  "draft": { "poId": null, "items": [], "totalAmount": 0, "version": 1 },
  "confirmed": { "draft": false, "submit": false },

  "tool_budget": { "llm_calls": 8, "tool_calls": 20, "llm_used": 5, "tool_used": 11 },
  "idempotency_key": "u001:A1:v1:hash...",
  "audit_trail": [],
  "checkpoint_id": "ckpt_003"
}
```

**三个关键点**（也是面试必问）：

- `slots.missing`：澄清策略只问缺失的槽位，**一次只问一个**；
- `draft.version` + `confirmed`：草稿是可变的、确认是有状态的，**确认后不允许再被新规划覆盖**；
- `tool_budget`：工具调用有预算，到顶强制收口，防循环。

---

## 八、权限与治理矩阵

| 能力 | 采购员 | 采购主管 | 管理员 | Agent |
|---|---|---|---|---|
| 查采购单/供应商/物流 | ✅ | ✅ | ✅ | ✅（限域内） |
| 建草稿 | ✅ | ✅ | ✅ | ✅（须确认） |
| 改草稿 | ✅ 自己的 | ✅ | ✅ | ✅（须确认，仅 draft） |
| 提交审批 | ✅ | ✅ | ✅ | ⚠️ 须二次确认 |
| 审批 | ❌ | ✅ | ✅ | ❌ |
| 收货入库 | ❌ 由仓管 | ❌ | ✅ | ❌ |
| 停用供应商 | ❌ | ✅ | ✅ | ❌ |
| 看 AI 报告/任务 | ✅ | ✅ | ✅ | — |

**Agent 额外约束**：

- 工具白名单：只能调 4.2 里注册的 19 个，**不允许任意 SQL**；
- 沿用当前登录用户权限（不放大）；
- 每次写操作落 `agent_audit_log`，可回溯"谁、何时、基于哪版草稿、哪个模型版本"。

---

## 九、指标与验收

| 工作流 | 核心指标 | 口径 |
|---|---|---|
| A1 建单 | 草稿采纳率、平均轮次、字段正确率 | 采纳率 = 确认创建的草稿数 / 生成草稿数 |
| A2 询价 | 推荐采纳率、比价耗时下降 | 采纳 = 用户选了 Agent 推荐的前 2 名之一 |
| A3 审阅 | 风险检出率、误报率 | 与人工复核结论比对，需构造 30 张标注单 |
| B1 巡检 | 逾期发现时长、待办点击率 | 从"应发现"到"被发现"的小时数 |
| B2 异常 | 报告可用率、方案采纳率 | 报告被下载/转发的比例 |
| C1 供应商 | 风险预警准确率 | 预警后 30 天内确实出问题的比例 |
| D1 问答 | 引用命中率、回答正确率 | 引用条款必须 100% 存在；人工抽检 50 条 |
| 通用 | 工具调用成功率、P95 时延、单次 token | 按 `ai_tool_calls` 统计 |

---

## 十、MVP 落地顺序

如果只有两周，按这个顺序做，每一步都有独立可演示的产出：

| 阶段 | 做什么 | 为什么先做这个 |
|---|---|---|
| **第 1 步** | **A1 建单 + D1 问答** | A1 闭环最短（一句话→草稿→单号），D1 成本最低且能立刻展示 RAG；两者合起来就能演"AI 真的在干活" |
| **第 2 步** | **B2 到货异常** | 痛点最强、报告形态最直观，且复用 A1 的确认卡片组件 |
| **第 3 步** | A2 询价 + A3 审阅 | 依赖 `supplier_quotes` 表，需要先有报价数据 |
| **第 4 步** | B1 巡检 + C1 供应商 | 依赖历史数据积累，否则指标全是"数据不足" |

**第 1 步之前必须先做的两件事**（不做后面全是返工）：

1. 建 `supplier_quotes` 和 `ai_tool_calls` 两张表；
2. 把"准时交付率""逾期天数""在途数量"三个口径写进 L3 知识库，并在所有页面统一使用同一套视图。

---

## 附：与现有实现的距离

| 能力 | 现状 | 差的 |
|---|---|---|
| 意图识别 | Mock 关键词匹配 | 换成模型分类 + 置信度阈值 |
| 工作流 | 单条链路，无子图 | 拆成 A1/A2/A3/B1/B2/C1/D1 七个可测子图 |
| 工具 | 6/19 | 补报价、价格基准、影响面、异常检测、合同、案例 |
| 数据库 | localStorage Mock | 新增 6 张表 + 3 个视图 |
| 知识库 | 3 段硬编码文本 | 五层语料 + 元数据 + 有效期过滤 + 引用校验 |
| 治理 | 前端提示 | 服务端拦截 + 审计表 + 幂等键 |
