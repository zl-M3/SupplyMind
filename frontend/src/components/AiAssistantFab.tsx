import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import {
  CloseOutlined,
  ExportOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { difyApi, type DifyStatus } from '@/services/api';
import { onOpenAiAssistant, onRequestAiAttachment } from '@/services/aiAssistant';
import MarkdownText from './MarkdownText';
import './AiAssistantFab.css';

/** 兜底外链（Dify WebApp 页面），用于「新窗口打开」 */
const BOT_URL =
  (import.meta.env as unknown as Record<string, string>).VITE_AI_BOT_URL ||
  ''; // 未配置 VITE_AI_BOT_URL 时为空；上线前在 .env 里配置你自己的 Dify WebApp 地址

/** Dify WebApp 路径：地址跟随后端返回的 base_url，换网段时不用改前端 */
const BOT_PATH = '/chatbot/lSPouUOPtojCycMu';

/** 拖动后的位置存这里，刷新页面也保持 */
const POS_KEY = 'sm:bot-pos';
const FAB_W = 88;
const FAB_H = 126;
const EDGE = 6;

/** 把悬浮球限制在窗口内 */
function clampPos(x: number, y: number) {
  const maxX = Math.max(EDGE, window.innerWidth - FAB_W - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - FAB_H - EDGE);
  return { x: Math.min(Math.max(EDGE, x), maxX), y: Math.min(Math.max(EDGE, y), maxY) };
}

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return clampPos(p.x, p.y);
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return null;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  /** 这条提问附带的资料文件名 */
  file?: string;
}

/** 把当前路由翻译成给助手看的上下文 */
function pageContext(): string {
  const p = window.location.pathname;
  const seg = p.split('/').filter(Boolean);
  const map: Record<string, string> = {
    dashboard: '工作台',
    'purchase/suppliers': '供应商管理',
    'purchase/orders': '采购订单',
    'purchase/logistics': '物流跟踪',
    'catalog/products': '商品管理',
    'catalog/stock': '库存总览',
    'catalog/alerts': '仓库预警',
    'catalog/warehouses': '仓库管理',
    'catalog/transactions': '库存流水',
    'ai/chat': 'AI 对话',
    'ai/tasks': 'Agent 任务中心',
    'ai/reports': 'AI 分析报告',
    settings: '系统设置',
  };
  const key = seg.slice(0, 2).join('/');
  const label = map[key] ?? map[seg[0]] ?? '业务页面';
  const last = seg[seg.length - 1];
  return seg.length > 2 ? `${label}（${last}）` : label;
}

const QUICK = ['哪些商品库存不足？', '有哪些采购单还没到货？', '最近哪家供应商交付有问题？'];

/**
 * 右下角 AI 小助手。
 *
 * 数据通路：组件 → /api/v1/ai/dify/chat/stream（本项目后端代理）→ 外部 Dify 应用。
 * 用 SSE 逐字渲染；密钥不进前端、没有 CORS 问题，还能带上当前页面上下文。
 */
export default function AiAssistantFab() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [bubble, setBubble] = useState(true);
  const [status, setStatus] = useState<DifyStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  /** 待随下一条问题一起发给 AI 的资料 */
  const [attachment, setAttachment] = useState<{ id: string; name: string; chars: number } | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const convRef = useRef('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  /** 悬浮球位置：null = 默认右下角 */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPos());
  /** 拖动状态：区分「点一下」和「拖走」 */
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  /** 外部（如工作台「AI 今日洞察」）要求自动发送的内容 */
  const pendingPromptRef = useRef<{ text: string; silent: boolean } | null>(null);

  // 开发期：?ai=open 展开面板；?ai=ready 模拟助手可用，便于调 UI
  useEffect(() => {
    if (import.meta.env.DEV) {
      const q = new URLSearchParams(window.location.search).get('ai');
      if (q === 'open') {
        setOpen(true);
        setBubble(false);
      }
      if (q === 'ready') {
        setOpen(true);
        setBubble(false);
        setStatus({
          enabled: true,
          configured: true,
          reachable: true,
          base_url: '', // dev 预览占位，真实值由后端 /ai/dify/status 返回
          detail: 'dev preview',
        });
      }
    }
    const t = window.setTimeout(() => setBubble(false), 8000);
    return () => window.clearTimeout(t);
  }, []);

  const check = useCallback(async (force = false) => {
    setProbing(true);
    try {
      setStatus(await difyApi.status(force));
    } catch (e) {
      setStatus({
        enabled: false,
        configured: false,
        reachable: false,
        base_url: '',
        detail: e instanceof Error ? e.message : '检测失败',
      });
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    if (open && !status) void check();
  }, [open, status, check]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, waiting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * 点击面板以外的空白区域（旁白区域）关闭面板。
   *
   * 面板是 position: fixed 的浮层，没有遮罩层，所以必须自己监听 document。
   * 用捕获阶段监听 pointerdown：先于页面上的点击/跳转生效，手感更接近「点一下就收起」。
   * 面板内部、悬浮球本身要排除：前者是正常操作，后者有自己的开合逻辑（否则会关掉又被点开）。
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (fabRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const send = async (text?: string, silent = false) => {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setInput('');

    const file = attachment;
    const aid = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      // 静默模式（如「AI 今日洞察」）：不展示长提示词，直接出结果
      ...(silent
        ? []
        : [{ id: `u-${Date.now()}`, role: 'user' as const, text: q, file: file?.name }]),
      { id: aid, role: 'assistant', text: '' },
    ]);
    setAttachment(null);
    setWaiting(true);
    setStreaming(true);

    await difyApi.chatStream(
      {
        query: q,
        context: pageContext(),
        conversationId: convRef.current,
        attachmentIds: file ? [file.id] : [],
      },
      {
        onDelta: (d) => {
          setWaiting(false);
          setMessages((prev) => prev.map((m) => (m.id === aid ? { ...m, text: m.text + d } : m)));
        },
        onDone: (cid) => {
          if (cid) convRef.current = cid;
          setWaiting(false);
          setStreaming(false);
        },
        onError: (msg) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aid ? { ...m, text: msg, error: true } : m)),
          );
          setWaiting(false);
          setStreaming(false);
        },
      },
    );
    setWaiting(false);
    setStreaming(false);
  };

  const ready = Boolean(status?.enabled && status?.reachable);

  /** 选文件 → 上传 → 后端抽文本，提问时一起发给 AI */
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const up = await difyApi.upload(file);
      setAttachment({ id: up.id, name: up.name, chars: up.chars });
      message.success(`已读入「${up.name}」${up.chars} 字${up.truncated ? '（超长已截断）' : ''}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 其它页面（如供应商管理）点「AI 分析资料」：打开面板并弹选文件 */
  useEffect(
    () =>
      onRequestAiAttachment(() => {
        setBubble(false);
        setOpen(true);
        window.setTimeout(() => fileRef.current?.click(), 200);
      }),
    [],
  );

  /** 新窗口打开 Dify WebApp：优先使用后端探测到的地址，避免 .env 与前端写死地址不一致 */
  const botUrl = status?.base_url
    ? `${status.base_url.replace(/\/+$/, '')}${BOT_PATH}`
    : BOT_URL;

  /* ---- 外部唤起：任何页面调 openAiAssistant(prompt) 都能打开并自动提问 ---- */
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(
    () =>
      onOpenAiAssistant(({ prompt, silent }) => {
        setBubble(false);
        setOpen(true);
        if (prompt) pendingPromptRef.current = { text: prompt, silent: Boolean(silent) };
      }),
    [],
  );

  // 助手可用后再发（状态是异步探测的，太早发会丢）
  useEffect(() => {
    if (!open || !ready) return;
    const q = pendingPromptRef.current;
    if (!q) return;
    pendingPromptRef.current = null;
    void sendRef.current(q.text, q.silent);
  }, [open, ready]);

  /* ---- 拖动悬浮球 ---- */
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // 新手势开始：清掉上一次拖动残留的"抑制点击"标记
    suppressClickRef.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 部分浏览器不支持，忽略 */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return; // 5px 内算点击，不算拖动
    d.moved = true;
    setPos(clampPos(d.ox + dx, d.oy + dy));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // 拖完不要顺带把面板打开（浏览器随后还会派发一次 click）
    if (d.moved) suppressClickRef.current = true;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
  };

  // 位置一变就持久化（拖动过程中同步写入，刷新/重开页面仍停在原处）
  useEffect(() => {
    if (!pos) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* 隐私模式忽略 */
    }
  }, [pos]);

  /** 面板跟随悬浮球：优先开在它上方，空间不够就开在下方，并保证不出屏 */
  const panelStyle = pos
    ? (() => {
        const w = 400;
        const h = Math.min(620, window.innerHeight - 180);
        const left = Math.min(
          Math.max(8, pos.x + FAB_W / 2 - w / 2),
          Math.max(8, window.innerWidth - w - 8),
        );
        const above = pos.y - h - 10;
        const below = pos.y + FAB_H + 10;
        const top =
          above >= 8 ? above : Math.min(below, Math.max(8, window.innerHeight - h - 8));
        return { left, top, right: 'auto', bottom: 'auto', height: h };
      })()
    : undefined;

  return (
    <>
      <div
        ref={panelRef}
        className={`sm-bot-panel ${open ? 'sm-bot-panel--open' : ''}`}
        role="dialog"
        aria-label="AI 智能助手对话"
        aria-hidden={!open}
        style={panelStyle}
      >
        <header className="sm-bot-head">
          <img className="sm-bot-head-avatar" src="/ai-mascot.png" alt="" aria-hidden="true" />
          <div className="sm-bot-head-text">
            <strong>SupplyMind 智能助手</strong>
            <span>
              <i className={`sm-bot-dot ${ready ? '' : 'sm-bot-dot--off'}`} />
              {probing ? '检测中…' : ready ? '在线' : '未连接'} · 可查库存 / 采购 / 物流
            </span>
          </div>
          <a
            className="sm-bot-head-btn"
            href={botUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="在新窗口打开助手"
            title="在新窗口打开"
          >
            <ExportOutlined />
          </a>
          <button
            type="button"
            className="sm-bot-head-btn"
            onClick={() => setOpen(false)}
            aria-label="关闭助手面板"
            title="关闭"
          >
            <CloseOutlined />
          </button>
        </header>

        <div className="sm-bot-body">
          {ready ? (
            <div className="sm-bot-chat">
              <div className="sm-bot-msgs" ref={bodyRef}>
                {messages.length === 0 && (
                  <div className="sm-bot-welcome">
                    <img src="/ai-mascot.png" alt="" aria-hidden="true" />
                    <p>你好，我是 SupplyMind 智能助手</p>
                    <small>可以问我库存、采购单、供应商和物流的情况</small>
                    <div className="sm-bot-quick">
                      {QUICK.map((q) => (
                        <button key={q} type="button" onClick={() => void send(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m) => {
                  // 等待回复时那个占位气泡是空的，交给下面的「正在查数据」提示，
                  // 否则会出现两个框（一个空框 + 一个三个点）
                  if (m.role === 'assistant' && !m.text && waiting) return null;
                  return (
                    <div key={m.id} className={`sm-bot-msg sm-bot-msg--${m.role}`}>
                      {m.role === 'assistant' && (
                        <img className="sm-bot-msg-avatar" src="/ai-mascot.png" alt="" aria-hidden="true" />
                      )}
                      <div className={`sm-bot-bubble-msg ${m.error ? 'sm-bot-bubble-msg--err' : ''}`}>
                        {m.file && (
                          <span className="sm-bot-msg-file">
                            <PaperClipOutlined /> {m.file}
                          </span>
                        )}
                        <MarkdownText text={m.text} />
                      </div>
                    </div>
                  );
                })}

                {waiting && (
                  <div className="sm-bot-msg sm-bot-msg--assistant">
                    <img className="sm-bot-msg-avatar" src="/ai-mascot.png" alt="" aria-hidden="true" />
                    <div className="sm-bot-bubble-msg sm-bot-typing">
                      <span />
                      <span />
                      <span />
                      <em className="sm-bot-typing-text">正在查数据…</em>
                    </div>
                  </div>
                )}
              </div>

              {attachment && (
                <div className="sm-bot-attach">
                  <PaperClipOutlined />
                  <span className="sm-bot-attach-name">{attachment.name}</span>
                  <span className="sm-bot-attach-meta">{attachment.chars} 字</span>
                  <button
                    type="button"
                    className="sm-bot-attach-remove"
                    onClick={() => setAttachment(null)}
                    aria-label="移除已上传资料"
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}
              <div className="sm-bot-input">
                <button
                  type="button"
                  className="sm-bot-attach-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="上传供应商资料"
                  title="上传资料（PDF / Word / Excel / 图片）"
                >
                  <PaperClipOutlined spin={uploading} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                  onChange={(e) => void onFileChange(e)}
                />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={attachment ? '资料已就绪，问点什么…' : '问库存、采购、供应商、物流…'}
                  rows={1}
                  aria-label="输入你的问题"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  type="button"
                  className="sm-bot-send"
                  onClick={() => void send()}
                  disabled={streaming || !input.trim()}
                  aria-label="发送"
                >
                  <SendOutlined />
                </button>
              </div>
              <div className="sm-bot-hint">上下文：{pageContext()}</div>
            </div>
          ) : (
            <div className="sm-bot-fallback" role="alert">
              <RobotOutlined className="sm-bot-fallback-icon" />
              <p>{probing ? '正在连接助手…' : '助手暂时连不上'}</p>
              <small>
                {status?.configured
                  ? `已配置 ${status.base_url || '助手地址'}，但当前网络访问不到它（不同网段 / 服务未启动 / 地址已变更）。`
                  : status?.detail || '后端尚未配置 DIFY_API_BASE 与 DIFY_API_KEY。'}
              </small>
              <div className="sm-bot-fallback-actions">
                <button type="button" onClick={() => void check(true)} disabled={probing}>
                  <ReloadOutlined /> 重试
                </button>
                <a href={botUrl} target="_blank" rel="noreferrer">
                  新窗口打开
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {bubble && !open && !pos && (
        <div className="sm-bot-bubble" role="status">
          有什么可以帮您？点我聊聊
          <span className="sm-bot-bubble-tail" />
        </div>
      )}

      <button
        type="button"
        ref={fabRef}
        className={`sm-bot-fab ${open ? 'sm-bot-fab--open' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false; // 刚刚拖动过，不当作点击
            return;
          }
          setBubble(false);
          setOpen((v) => !v);
        }}
        style={
          pos
            ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', cursor: 'grab' }
            : { cursor: 'grab' }
        }
        title="点击对话，按住可拖动"
        aria-expanded={open}
        aria-label={open ? '收起 AI 智能助手' : '打开 AI 智能助手（可拖动）'}
      >
        <span className="sm-bot-ring" aria-hidden="true" />
        <span className="sm-bot-ring sm-bot-ring--delay" aria-hidden="true" />
        <img className="sm-bot-img" src="/ai-mascot.png" alt="" aria-hidden="true" />
        <span className="sm-bot-ground" aria-hidden="true" />
        {!open && (
          <span className="sm-bot-badge" aria-hidden="true">
            <RobotOutlined />
          </span>
        )}
      </button>
    </>
  );
}
