/**
 * AI 智能中心 · 对话服务
 *
 * real（默认）：走后端 /api/v1/ai/*，历史消息保存在 ai_conversations / ai_messages 表；
 * mock：仍然用浏览器 localStorage 的演示数据（VITE_API_MODE=mock）。
 *
 * 页面只依赖这里暴露的 list / get / chat，切换模式不影响 UI。
 */

import type {
  AiConversation,
  AiConversationBrief,
  AiEvidence,
  AiMessage,
  AiReply,
  AiReport,
  PurchaseDraftPayload,
  ToolCallLog,
} from '@/types';
import { getToken, http } from './http';

export const AI_CHAT_MODE: 'mock' | 'real' =
  (import.meta.env as unknown as Record<string, string>).VITE_API_MODE === 'mock' ? 'mock' : 'real';

export interface AiChatPayload {
  content: string;
  conversationId?: string;
}

export interface AiChatResult {
  conversationId: string;
}

export interface AiStreamHandlers {
  onDelta: (text: string) => void;
  onDone: (conversationId: string) => void;
  onError: (message: string) => void;
}

const str = (v: unknown, fallback = ''): string =>
  v === null || v === undefined ? fallback : String(v);

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 后端统一按 UTC 存时间（naive datetime），浏览器会把 "2026-11-01T16:19:00"
 * 当成当地时间，导致刚发的消息显示「8 小时前」。这里补上 Z 再转本地时间。
 */
function toLocal(v: unknown): string {
  const raw = str(v);
  if (!raw) return raw;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  const date = new Date(raw.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

/** 后端「数据依据」是字符串数组，前端渲染需要 label/value */
function mapEvidence(raw: unknown): AiReply['evidence'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return { label: str(obj.label), value: str(obj.value) };
    }
    const text = str(item);
    const idx = text.indexOf('：');
    return idx > 0
      ? { label: text.slice(0, idx), value: text.slice(idx + 1).trim() }
      : { label: '依据', value: text };
  });
}

function mapToolCalls(raw: unknown): ToolCallLog[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      name: str(obj.name, 'tool'),
      params: str(obj.summary) || JSON.stringify(obj.arguments ?? {}),
      status: obj.status === 'failed' ? 'failed' : 'success',
      durationMs: num(obj.duration_ms),
    };
  });
}

/** 后端采购草稿确认数据 → 前端草稿卡片 */
function mapDraft(raw: unknown): PurchaseDraftPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const supplierId = str(obj.supplier_id);
  const items = Array.isArray(obj.items) ? obj.items : [];
  if (!supplierId || items.length === 0) return undefined;
  return {
    supplierId,
    supplierName: str(obj.supplier_name),
    items: items.map((line) => {
      const item = (line ?? {}) as Record<string, unknown>;
      return {
        productId: str(item.product_id),
        productName: str(item.product_name),
        spec: str(item.spec),
        unit: str(item.unit),
        qty: num(item.qty),
        price: num(item.price),
      };
    }),
    totalAmount: num(obj.total_amount),
    basis: Array.isArray(obj.basis) ? obj.basis.map((b) => str(b)) : [],
    expectedArrival: str(obj.expected_arrival),
  };
}

/** 去掉 markdown 记号，结论用纯文本展示（小助手落库的内容带 ** 和 ###） */
function plain(text: string): string {
  return text
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

/** 后端 ai_messages → 前端 AiMessage（assistant 消息还原五段式结构） */
function mapMessage(raw: unknown): AiMessage {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const role = obj.role === 'assistant' ? 'assistant' : 'user';
  const content = str(obj.content);
  let reply: AiReply | undefined;
  if (role === 'assistant') {
    const sectionTitles = ['结论', '数据依据', '原因分析', '建议动作', '可执行操作'];
    const firstLine = content
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => Boolean(line) && !sectionTitles.includes(line));
    reply = {
      conclusion: plain(str(obj.conclusion) || firstLine || content),
      evidence: mapEvidence(obj.evidence),
      cause: obj.cause ? plain(str(obj.cause)) : undefined,
      actions: Array.isArray(obj.actions) ? obj.actions.map((a) => plain(str(a))) : [],
      toolCalls: mapToolCalls(obj.tool_calls),
      draft: mapDraft(obj.draft_payload),
      taskId: obj.task_id ? str(obj.task_id) : undefined,
      citations: Array.isArray(obj.citations)
        ? obj.citations.map((c: any) => ({
            title: str(c?.title),
            section: str(c?.section),
            score: typeof c?.score === 'number' ? c.score : undefined,
            snippet: str(c?.snippet),
          }))
        : [],
    };
  }
  return {
    id: str(obj.id),
    role,
    content,
    at: toLocal(obj.created_at),
    reply,
  };
}

function mapConversation(raw: unknown): AiConversation {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(obj.id),
    title: str(obj.title) || '新对话',
    createdAt: toLocal(obj.created_at),
    updatedAt: toLocal(obj.updated_at),
    messages: Array.isArray(obj.messages) ? obj.messages.map(mapMessage) : [],
  };
}

/* ------------------------------------------------------------------ */
/* 真实后端                                                            */
/* ------------------------------------------------------------------ */

const realAiApi = {
  /** 我的会话列表（数据库 ai_conversations） */
  list: async (): Promise<AiConversationBrief[]> => {
    const raw = await http.get<any>('/ai/conversations', { page: 1, page_size: 50 });
    const items: any[] = Array.isArray(raw) ? raw : (raw?.items ?? []);
    return items.map((row) => ({
      id: str(row.id),
      title: str(row.title) || '新对话',
      messageCount: num(row.message_count),
      createdAt: toLocal(row.created_at),
      updatedAt: toLocal(row.updated_at),
    }));
  },

  /** 会话详情（含历史消息） */
  get: async (id: string): Promise<AiConversation> =>
    mapConversation(await http.get<any>(`/ai/conversations/${id}`)),

  /** 发送一条消息：后端写入 user/assistant 两条消息并返回会话ID */
  chat: async (payload: AiChatPayload): Promise<AiChatResult> => {
    const raw = await http.post<any>('/ai/chat', {
      content: payload.content,
      conversation_id: payload.conversationId || undefined,
    });
    return { conversationId: str(raw?.conversation_id) };
  },

  /** 流式对话：后端先跑 Agent 落库，再逐字推答案 */
  chatStream: async (payload: AiChatPayload, handlers: AiStreamHandlers): Promise<void> => {
    const res = await fetch('/api/v1/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        content: payload.content,
        conversation_id: payload.conversationId || undefined,
      }),
    });
    if (!res.ok || !res.body) {
      let msg = `AI 接口异常（HTTP ${res.status}）`;
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
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        let evt: any;
        try {
          evt = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (evt?.error) {
          handlers.onError(String(evt.error));
          return;
        }
        if (evt?.delta) handlers.onDelta(String(evt.delta));
        if (evt?.done) handlers.onDone(str(evt.conversation_id));
      }
    }
  },
};

/* ------------------------------------------------------------------ */
/* 本地演示（VITE_API_MODE=mock）                                      */
/* ------------------------------------------------------------------ */

const mockAiApi = {
  list: async (): Promise<AiConversationBrief[]> => {
    const { conversationApi } = await import('@/mock/agent');
    const list = await conversationApi.list();
    return list.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  },

  get: async (id: string): Promise<AiConversation> => {
    const { conversationApi } = await import('@/mock/agent');
    return conversationApi.get(id);
  },

  chat: async (payload: AiChatPayload): Promise<AiChatResult> => {
    const { askAgent } = await import('@/mock/agent');
    const res = await askAgent(payload.content, undefined, payload.conversationId);
    return { conversationId: res.conversationId };
  },

  chatStream: async (payload: AiChatPayload, handlers: AiStreamHandlers): Promise<void> => {
    const res = await mockAiApi.chat(payload);
    const conv = await mockAiApi.get(res.conversationId);
    const last = conv.messages[conv.messages.length - 1];
    if (last?.content) handlers.onDelta(last.content);
    handlers.onDone(res.conversationId);
  },
};

export const aiApi = AI_CHAT_MODE === 'real' ? realAiApi : mockAiApi;

/* ------------------------------------------------------------------ */
/* 知识库（RAG）                                                       */
/* ------------------------------------------------------------------ */

export interface KnowledgeDoc {
  slug: string;
  title: string;
  section_count: number;
  chars: number;
}

export interface KnowledgeHit {
  title: string;
  section: string;
  slug: string;
  content: string;
  score: number;
}

export const knowledgeApi = {
  list: async (): Promise<KnowledgeDoc[]> => await http.get<KnowledgeDoc[]>('/ai/knowledge'),
  search: async (q: string, topK = 5): Promise<KnowledgeHit[]> =>
    q.trim()
      ? await http.get<KnowledgeHit[]>('/ai/knowledge/search', { q, top_k: topK })
      : [],
  upload: async (filename: string, content: string): Promise<{ slug: string; chunks: number }> =>
    await http.post('/ai/knowledge', { filename, content }),
};

export const feedbackApi = {
  submit: async (messageId: string, score: number, comment?: string): Promise<void> => {
    await http.post(`/ai/messages/${messageId}/feedback`, { score, comment });
  },
  summary: async (): Promise<{ total: number; up: number; down: number; satisfaction: number | null }> =>
    await http.get('/ai/feedback/summary'),
};

/* ------------------------------------------------------------------ */
/* AI 分析报告（真实后端）                                              */
/* ------------------------------------------------------------------ */

function mapReportBrief(row: any): AiReport {
  return {
    id: str(row?.id),
    type: (row?.type ?? 'replenishment') as AiReport['type'],
    title: str(row?.title),
    targetName: str(row?.target_name),
    targetId: str(row?.target_id),
    createdAt: toLocal(row?.created_at),
    conclusion: '',
    evidence: [],
    cause: '',
    suggestions: [],
  };
}

function mapReport(row: any): AiReport {
  return {
    ...mapReportBrief(row),
    conclusion: plain(str(row?.conclusion)),
    evidence: mapEvidence(row?.evidence),
    cause: plain(str(row?.cause)),
    suggestions: Array.isArray(row?.suggestions) ? row.suggestions.map((s: any) => plain(str(s))) : [],
  };
}

export const reportApi = {
  list: async (): Promise<AiReport[]> => {
    const raw = await http.get<any>('/ai/reports', { page: 1, page_size: 200 });
    return ((raw?.items ?? []) as any[]).map(mapReportBrief);
  },
  get: async (id: string): Promise<AiReport> => mapReport(await http.get<any>(`/ai/reports/${id}`)),
};

export const reportScheduleApi = {
  get: async (): Promise<{ enabled: boolean; daily_time: string; last_run: string | null }> =>
    await http.get('/ai/report-schedule'),
  save: async (enabled: boolean, dailyTime: string): Promise<void> => {
    await http.put('/ai/report-schedule', { enabled, daily_time: dailyTime });
  },
};

export const optimizeApi = {
  replenishment: async (): Promise<{
    plan: Array<{
      product_id: string;
      product_name: string;
      category: string;
      qty: number;
      best: { supplier_id: string; supplier_name: string; price: number; source: string };
      cost: number;
      baseline: number;
      savings: number;
    }>;
    total_cost: number;
    baseline_cost: number;
    savings: number;
    note: string;
  }> => await http.post('/ai/optimize/replenishment'),
};
