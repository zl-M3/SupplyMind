/**
 * Mock Agent
 *
 * 模拟「一个主 Agent + 7 个工具」的行为：
 *   query_inventory / query_purchase_orders / query_supplier / query_logistics
 *   calculate_replenishment / create_purchase_draft / retrieve_business_knowledge
 *
 * 真实实现里这些工具跑在后端；前端只负责展示，不负责决策。
 * 这里为了让演示可跑，把意图识别和工具编排放在了前端 mock 层。
 */

import dayjs from 'dayjs';
import type {
  AgentTask,
  AiConversation,
  AiMessage,
  AiPageContext,
  AiReply,
  AiReport,
  PurchaseDraftPayload,
  PurchaseOrder,
  ToolCallLog,
} from '@/types';
import { getDb, mutate, nextSeq } from './db';
import { buildStockOverview, inTransitQty, isLogisticsDelayed, supplierMetrics } from '@/services/rules';
import { API_MODE, purchaseOrderApi } from '@/services/api';
import { http } from '@/services/http';
import { daysLater, fmtDate } from '@/utils/format';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/** 记录一次工具调用（模拟耗时） */
async function tool(name: string, params: string): Promise<ToolCallLog> {
  const durationMs = rand(48, 210);
  await sleep(rand(30, 90));
  return { name, params, status: 'success', durationMs };
}

const PRODUCT_ID_RE = /PRD-\d+/;
const LOG_ID_RE = /LOG-\d+/;
const PO_ID_RE = /PO-\d{8}-\d{3}/;

/* ------------------------------------------------------------------ */
/* 意图识别                                                            */
/* ------------------------------------------------------------------ */

type Intent =
  | 'inventory'
  | 'replenishment'
  | 'purchase'
  | 'supplier'
  | 'logistics'
  | 'knowledge'
  | 'unknown';

function detectIntent(question: string, ctx?: AiPageContext): Intent {
  const q = question.toLowerCase();
  if (/制度|规范|流程|审批要求|怎么审批|规定/.test(q)) return 'knowledge';
  if (/补货|补多少|采购多少|建议采购量|算一下/.test(q) || /库存预警/.test(ctx?.pageName ?? '')) {
    return 'replenishment';
  }
  if (/物流|延迟|延误|轨迹|到货没有|到达/.test(q)) return 'logistics';
  if (/供应商|准时|交付率|履约/.test(q)) return 'supplier';
  if (/采购单|采购订单|订单|没到货|未到货/.test(q)) return 'purchase';
  if (/库存|缺货|低库存|不足/.test(q)) {
    if (/补货|补多少/.test(q)) return 'replenishment';
    return 'inventory';
  }
  // 从业务页面唤起时，按页面归属兜底
  const page = ctx?.pageName ?? '';
  if (page.includes('物流')) return 'logistics';
  if (page.includes('供应商')) return 'supplier';
  if (page.includes('库存')) return 'inventory';
  if (page.includes('采购')) return 'purchase';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* 各意图的回复构造                                                     */
/* ------------------------------------------------------------------ */

async function replyInventory(question: string): Promise<AiReply> {
  const db = getDb();
  const rows = buildStockOverview(db).filter((r) => r.level !== 'normal');
  const call = await tool('query_inventory', '{ "levels": ["out", "low"] }');
  const out = rows.filter((r) => r.level === 'out');
  const low = rows.filter((r) => r.level === 'low');

  return {
    conclusion:
      rows.length === 0
        ? '当前所有商品库存都在安全线以上，没有缺货或低库存商品。'
        : `当前有 ${out.length} 个商品缺货、${low.length} 个商品低库存，主要集中在包装材料类。`,
    evidence: rows.slice(0, 6).map((r) => ({
      label: r.productName,
      value: `${r.totalQty} / 安全库存 ${r.safetyStock} ${r.unit}${r.inTransitQty ? `，在途 ${r.inTransitQty}` : ''}`,
    })),
    cause:
      out.length > 0
        ? '缺货商品在三个仓库的库存均已清零，且部分在途采购单受物流滞留影响未能及时入库。'
        : undefined,
    actions: ['对缺口最大的商品生成补货建议', '查看库存预警列表', '发起仓库间调拨'],
    toolCalls: [call],
  };
}

async function replyReplenishment(question: string, ctx?: AiPageContext): Promise<AiReply> {
  const db = getDb();
  const rows = buildStockOverview(db);
  const wanted = question.match(PRODUCT_ID_RE)?.[0] ?? ctx?.targetId;
  const target =
    rows.find((r) => r.productId === wanted) ??
    rows.find((r) => question.includes(r.productName)) ??
    [...rows].sort((a, b) => b.gap - a.gap)[0];

  if (!target) {
    return {
      conclusion: '没有找到需要补货的商品。',
      evidence: [],
      actions: [],
      toolCalls: [],
    };
  }

  const product = db.products.find((p) => p.id === target.productId)!;
  const calls = [
    await tool('query_inventory', `{ "productId": "${product.id}" }`),
    await tool('calculate_replenishment', `{ "productId": "${product.id}", "safetyStock": ${product.safetyStock} }`),
  ];

  const qty = target.suggestedQty > 0 ? target.suggestedQty : target.safetyStock;
  const supplier =
    db.suppliers.find((s) => s.status === 'active' && s.categories.includes(product.category)) ??
    db.suppliers.find((s) => s.status === 'active')!;

  const draft: PurchaseDraftPayload = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    items: [
      {
        productId: product.id,
        productName: product.name,
        spec: product.spec,
        unit: product.unit,
        qty,
        price: product.purchasePrice,
      },
    ],
    totalAmount: Number((qty * product.purchasePrice).toFixed(2)),
    basis: [
      `安全库存：${product.safetyStock} ${product.unit}`,
      `当前可用库存：${target.totalQty} ${product.unit}`,
      `已审批未收货：${target.inTransitQty} ${product.unit}`,
      `建议采购量 = max(0, ${product.safetyStock} − ${target.totalQty} − ${target.inTransitQty}) = ${qty} ${product.unit}`,
    ],
    expectedArrival: daysLater(5),
  };

  // 落地一条待确认任务，模拟 Agent 任务中心
  const taskId = `TASK-${nextSeq('task')}`;
  mutate((d) => {
    d.agentTasks.unshift({
      id: taskId,
      name: `库存补货建议 · ${product.name}`,
      type: 'replenishment',
      createdBy: d.users.find((u) => u.id === d.currentUserId)?.name ?? '当前用户',
      createdAt: new Date().toISOString(),
      status: 'waiting_confirm',
      summary: `${product.name} 建议采购 ${qty} ${product.unit}，金额 ¥${draft.totalAmount.toFixed(2)}。`,
      toolCalls: calls,
      payload: draft,
    });
  });

  return {
    conclusion: `${product.name} 当前可用 ${target.totalQty} ${product.unit}，建议采购 ${qty} ${product.unit}。`,
    evidence: [
      { label: '安全库存', value: `${product.safetyStock} ${product.unit}` },
      { label: '当前可用库存', value: `${target.totalQty} ${product.unit}` },
      { label: '已审批未收货', value: `${target.inTransitQty} ${product.unit}` },
      { label: '建议采购量', value: `${qty} ${product.unit}` },
      { label: '推荐供应商', value: `${supplier.name}（¥${product.purchasePrice}/${product.unit}）` },
      { label: '预计金额', value: `¥${draft.totalAmount.toFixed(2)}` },
    ],
    cause:
      target.level === 'out'
        ? '该商品库存已清零，且在途数量不足以覆盖安全库存，需要立即补货。'
        : '当前库存低于安全库存，按首期公式计算仍存在缺口。',
    actions: ['确认后生成采购草稿（不会直接审批）', '调整数量后重新计算', '改为仓间调拨补缺口'],
    draft,
    toolCalls: calls,
    taskId,
  };
}

async function replyPurchase(question: string): Promise<AiReply> {
  const db = getDb();
  const calls = [
    await tool('query_purchase_orders', '{ "status": ["pending", "approved", "partial"] }'),
    await tool('query_logistics', '{ "onlyDelayed": true }'),
  ];
  const open = db.purchaseOrders.filter((po) =>
    ['pending', 'approved', 'partial'].includes(po.status),
  );
  const late = open.filter((po) => dayjs(po.expectedArrival).isBefore(dayjs()));

  return {
    conclusion:
      open.length === 0
        ? '当前没有未完成的采购订单。'
        : `当前有 ${open.length} 张采购订单未完成，其中 ${late.length} 张已超过预计到货日期仍未收齐。`,
    evidence: open.slice(0, 6).map((po) => ({
      label: po.code,
      value: `${po.supplierName}｜预计 ${fmtDate(po.expectedArrival)}｜${
        po.status === 'pending' ? '待审批' : `待收货 ${po.items.reduce((s, i) => s + i.qty - i.receivedQty, 0)} 件`
      }`,
    })),
    cause:
      late.length > 0
        ? `${late.length} 张订单的物流已超过预计到达时间，建议先看物流详情确认责任方。`
        : undefined,
    actions: ['打开物流跟踪查看延迟单', '对未完成订单登记收货', '为缺口商品生成采购草稿'],
    toolCalls: calls,
  };
}

async function replySupplier(): Promise<AiReply> {
  const db = getDb();
  const call = await tool('query_supplier', '{ "withMetrics": true }');
  const list = db.suppliers
    .filter((s) => s.status === 'active')
    .map((s) => ({ supplier: s, metrics: supplierMetrics(db, s.id) }))
    .sort((a, b) => (a.metrics.onTimeRate ?? 1) - (b.metrics.onTimeRate ?? 1));
  const risky = list.filter((x) => x.metrics.onTimeRate != null && x.metrics.onTimeRate < 0.8);

  return {
    conclusion:
      risky.length === 0
        ? '在合作供应商中没有准时交付率低于 80% 的。'
        : `有 ${risky.length} 家供应商准时交付率低于 80% 合格线，建议增加备选供应商。`,
    evidence: list.slice(0, 5).map((x) => ({
      label: x.supplier.name,
      value:
        x.metrics.onTimeRate == null
          ? '数据不足（完成订单不足 2 单）'
          : `准时率 ${(x.metrics.onTimeRate * 100).toFixed(0)}%｜完成 ${x.metrics.completedCount} 单｜延迟 ${x.metrics.delayCount} 单`,
    })),
    cause: risky[0]
      ? `${risky[0].supplier.name} 的延迟集中在近期订单，且未主动同步延期原因。`
      : undefined,
    actions: ['查看该供应商详情与关联订单', '把新订单转给备选供应商', '要求供应商补充交付计划'],
    toolCalls: [call],
  };
}

async function replyLogistics(question: string, ctx?: AiPageContext): Promise<AiReply> {
  const db = getDb();
  const wantedId = question.match(LOG_ID_RE)?.[0] ?? ctx?.targetId;
  const lo =
    db.logisticsOrders.find((x) => x.id === wantedId || x.code === wantedId) ??
    [...db.logisticsOrders]
      .filter((x) => isLogisticsDelayed(x))
      .sort((a, b) => dayjs(a.expectedArrival).valueOf() - dayjs(b.expectedArrival).valueOf())[0] ??
    db.logisticsOrders[0];

  if (!lo) {
    return { conclusion: '当前没有可分析的物流单。', evidence: [], actions: [], toolCalls: [] };
  }

  const calls = [
    await tool('query_logistics', `{ "logisticsId": "${lo.id}" }`),
    await tool('query_purchase_orders', `{ "poId": "${lo.poId}" }`),
    await tool('query_inventory', '{ "productIds": ["PRD-003", "PRD-009"] }'),
  ];
  await tool('retrieve_business_knowledge', '{ "query": "物流异常处理规范" }');

  const po = db.purchaseOrders.find((p) => p.id === lo.poId);
  const delayDays = Math.max(0, dayjs().diff(dayjs(lo.expectedArrival), 'day'));
  const affected = (po?.items ?? []).map((i) => {
    const row = buildStockOverview(db).find((r) => r.productId === i.productId);
    return `${i.productName} × ${i.qty}${i.unit}（当前库存 ${row?.totalQty ?? 0}）`;
  });

  // 生成报告 + 任务记录
  const reportId = `RPT-${nextSeq('report')}`;
  const taskId = `TASK-${nextSeq('task')}`;
  const me = db.users.find((u) => u.id === db.currentUserId)?.name ?? '当前用户';
  const nowIso = new Date().toISOString();
  const report: AiReport = {
    id: reportId,
    type: 'logistics_anomaly',
    title: `物流异常分析报告 · ${lo.code}`,
    targetName: lo.code,
    targetId: lo.id,
    createdAt: nowIso,
    conclusion: `物流单已延误 ${delayDays} 天，最近节点为「${lo.events[lo.events.length - 1]?.node ?? '-'}」，需评估对库存的影响。`,
    evidence: [
      { label: '采购订单', value: po?.code ?? lo.poCode },
      { label: '供应商', value: lo.supplierName },
      { label: '承运商', value: `${lo.carrier}（${lo.trackingNo}）` },
      { label: '预计到达', value: `${fmtDate(lo.expectedArrival)}，已超期 ${delayDays} 天` },
      { label: '在途商品', value: affected.join('；') || '-' },
    ],
    cause:
      lo.events.find((e) => e.node.includes('异常'))?.desc ??
      '轨迹显示快件在运输节点滞留时间超过正常范围，暂未获得承运商正式说明。',
    suggestions: [
      '确认该批货物对客户交付的影响程度',
      '从库存充足的仓库发起调拨，缓解短期缺口',
      '与承运商确认新的到达时间，必要时按合同主张补偿',
    ],
  };
  mutate((d) => {
    d.aiReports.unshift(report);
    d.agentTasks.unshift({
      id: taskId,
      name: `物流异常分析 · ${lo.code}`,
      type: 'logistics_analysis',
      createdBy: me,
      createdAt: nowIso,
      status: 'done',
      summary: report.conclusion,
      toolCalls: calls,
      resultText: `已生成《${report.title}》，可在 AI 分析报告中查看。`,
    });
  });

  return {
    conclusion: report.conclusion,
    evidence: report.evidence,
    cause: report.cause,
    actions: report.suggestions,
    toolCalls: calls,
    taskId,
    reportId,
  };
}

async function replyKnowledge(question: string): Promise<AiReply> {
  const call = await tool('retrieve_business_knowledge', `{ "query": "${question.slice(0, 20)}" }`);
  const doc = question.includes('采购') || question.includes('审批')
    ? {
        title: '《采购审批规范》第 3 条',
        text: '采购订单需由采购员创建并提交，金额超过 5 万元或涉及危化品的订单须经供应链中心负责人审批；创建人与审批人不得为同一人。',
      }
    : question.includes('物流')
      ? {
          title: '《物流异常处理规范》第 2 条',
          text: '物流超过预计到达时间 24 小时未更新节点的，系统标记为延迟；超期 3 天须生成异常分析报告并明确责任方。',
        }
      : {
          title: '《库存预警处理规范》第 1 条',
          text: '库存为 0 视为缺货，低于安全库存视为低库存；缺货商品应在 24 小时内发起补货，补货量按安全库存扣减可用库存与在途数量计算。',
        };

  return {
    conclusion: `根据制度文档：${doc.text}`,
    evidence: [
      { label: '检索来源', value: doc.title },
      { label: '检索方式', value: 'RAG（制度文档库，4 篇）' },
    ],
    actions: ['查看相关业务列表', '打开 AI 分析报告'],
    toolCalls: [call],
  };
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                             */
/* ------------------------------------------------------------------ */

export interface AskResult {
  reply: AiReply;
  conversationId: string;
  messageId: string;
}

let msgSeq = 0;

export async function askAgent(
  question: string,
  ctx?: AiPageContext,
  conversationId?: string,
): Promise<AskResult> {
  const db = getDb();
  const me = db.users.find((u) => u.id === db.currentUserId)?.name ?? '当前用户';

  // 上下文前置提示：页面上下文只帮助理解意图，不代表权限
  const intent = detectIntent(question, ctx);
  let reply: AiReply;
  switch (intent) {
    case 'inventory':
      reply = await replyInventory(question);
      break;
    case 'replenishment':
      reply = await replyReplenishment(question, ctx);
      break;
    case 'purchase':
      reply = await replyPurchase(question);
      break;
    case 'supplier':
      reply = await replySupplier();
      break;
    case 'logistics':
      reply = await replyLogistics(question, ctx);
      break;
    case 'knowledge':
      reply = await replyKnowledge(question);
      break;
    default:
      reply = {
        conclusion:
          '我可以帮你查询库存、采购订单、供应商和物流情况，并按规则计算补货建议、生成采购草稿。',
        evidence: [
          { label: '可查询', value: '库存与安全库存、采购订单状态、供应商履约、物流轨迹' },
          { label: '可计算', value: '建议补货量 = max(0, 安全库存 − 当前库存 − 在途)' },
          { label: '可执行', value: '生成采购草稿（需你确认后才创建，不会自动审批）' },
        ],
        actions: ['哪些商品库存不足？', 'PRD-003 需要补多少货？', '有哪些物流延迟了？', '采购审批有什么规定？'],
        toolCalls: [],
      };
  }

  msgSeq += 1;
  const convId = conversationId ?? `CONV-${nextSeq('conv')}`;
  const userMsg: AiMessage = {
    id: `MSG-U-${Date.now()}-${msgSeq}`,
    role: 'user',
    content: question,
    at: new Date().toISOString(),
  };
  const aiMsg: AiMessage = {
    id: `MSG-A-${Date.now()}-${msgSeq}`,
    role: 'assistant',
    content: reply.conclusion,
    at: new Date().toISOString(),
    reply,
  };

  mutate((d) => {
    let conv = d.aiConversations.find((c) => c.id === convId);
    if (!conv) {
      conv = {
        id: convId,
        title: question.slice(0, 24),
        createdAt: userMsg.at,
        updatedAt: userMsg.at,
        messages: [],
      };
      d.aiConversations.unshift(conv);
    }
    conv.messages.push(userMsg, aiMsg);
    conv.updatedAt = aiMsg.at;
    conv.title = conv.title || question.slice(0, 24);
    void me;
  });

  return { reply, conversationId: convId, messageId: aiMsg.id };
}

/** 确认草稿 → 走业务接口创建采购草稿（不自动审批） */
export async function confirmDraft(
  draft: PurchaseDraftPayload,
  taskId?: string,
): Promise<PurchaseOrder> {
  // 真实后端：优先走 AI 任务的确认接口（任务会被置为 done，同一草稿不能重复创建）
  if (taskId && API_MODE === 'real') {
    const result = await http.post<{ order_id?: string; order_code?: string }>(
      `/ai/tasks/${taskId}/confirm`,
      {
        items: draft.items.map((i) => ({ product_id: i.productId, qty: i.qty, price: i.price })),
        expected_arrival: (draft.expectedArrival || '').slice(0, 10) || undefined,
        remark: `由 AI 助手生成，依据：${draft.basis.join('；')}`,
      },
    );
    if (result?.order_id) return purchaseOrderApi.get(result.order_id);
  }

  const po = await purchaseOrderApi.create({
    supplierId: draft.supplierId,
    expectedArrival: draft.expectedArrival,
    remark: `由 AI 助手生成，依据：${draft.basis.join('；')}`,
    items: draft.items.map((i) => ({ productId: i.productId, qty: i.qty, price: i.price })),
  });
  if (taskId) {
    mutate((d) => {
      const t = d.agentTasks.find((x) => x.id === taskId);
      if (t) {
        t.status = 'done';
        t.resultText = `已创建采购草稿 ${po.code}，请到采购订单中提交审批。`;
      }
    });
  }
  return po;
}

/* ---------------- 会话 ---------------- */

export const conversationApi = {
  list: async (): Promise<AiConversation[]> => {
    await sleep(120);
    return clone(getDb().aiConversations.slice().sort((a, b) => dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf()));
  },
  get: async (id: string): Promise<AiConversation> => {
    await sleep(100);
    const conv = getDb().aiConversations.find((c) => c.id === id);
    if (!conv) throw new Error('会话不存在');
    return clone(conv);
  },
};

/* ---------------- 任务 ---------------- */

export const taskApi = {
  list: async (status?: string): Promise<AgentTask[]> => {
    await sleep(160);
    const list = getDb().agentTasks.filter((t) => (status ? t.status === status : true));
    return clone(list);
  },

  get: async (id: string): Promise<AgentTask> => {
    await sleep(100);
    const t = getDb().agentTasks.find((x) => x.id === id);
    if (!t) throw new Error('任务不存在');
    return clone(t);
  },

  confirm: async (id: string): Promise<PurchaseOrder> => {
    const task = getDb().agentTasks.find((t) => t.id === id);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'waiting_confirm' || !task.payload) throw new Error('该任务不在待确认状态');
    return confirmDraft(task.payload, id);
  },

  cancel: async (id: string): Promise<void> => {
    mutate((d) => {
      const t = d.agentTasks.find((x) => x.id === id);
      if (!t) throw new Error('任务不存在');
      t.status = 'failed';
      t.error = '用户取消了该任务';
    });
    await sleep(120);
  },

  retry: async (id: string): Promise<void> => {
    mutate((d) => {
      const t = d.agentTasks.find((x) => x.id === id);
      if (!t) throw new Error('任务不存在');
      t.status = 'running';
      t.error = undefined;
    });
    await sleep(900);
    mutate((d) => {
      const t = d.agentTasks.find((x) => x.id === id)!;
      // 演示：重试后成功
      t.status = 'done';
      t.resultText = t.resultText ?? '重试成功，已重新完成分析。';
      t.toolCalls = t.toolCalls.map((c) => ({ ...c, status: 'success', durationMs: rand(80, 260) }));
    });
  },
};

/* ---------------- 报告 ---------------- */

export const reportApi = {
  list: async (): Promise<AiReport[]> => {
    await sleep(140);
    return clone(getDb().aiReports.slice().sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()));
  },
  get: async (id: string): Promise<AiReport> => {
    await sleep(100);
    const r = getDb().aiReports.find((x) => x.id === id);
    if (!r) throw new Error('报告不存在');
    return clone(r);
  },
};

/** 未完成任务的快捷计数，给侧边栏与工作台用 */
export function pendingTaskCount(): number {
  return getDb().agentTasks.filter((t) => t.status === 'waiting_confirm').length;
}
