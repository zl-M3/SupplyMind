/**
 * AI 小助手（Dify）的全局入口
 *
 * 页面不直接渲染助手面板，只发一个事件：
 *    openAiAssistant('帮我看下今天的待审批采购单')  →  右下角助手面板展开并自动发送这句话
 *
 * 这样做的好处：任何页面（工作台「AI 今日洞察」、表格行内按钮…）都能唤起同一个助手，
 * 不用把 AiAssistantFab 的状态提到顶层 Context。
 */

export const AI_ASSISTANT_EVENT = 'sm:ai-assistant-open';

export interface AiAssistantRequest {
  /** 打开面板后自动发送的内容；不传则只打开面板 */
  prompt?: string;
  /** true：不把提示词显示成用户气泡，直接出结果（如「AI 今日洞察」） */
  silent?: boolean;
}

/** 打开 AI 助手面板，可选自动发送一条提问 */
export function openAiAssistant(prompt?: string, silent = false): void {
  try {
    window.dispatchEvent(
      new CustomEvent<AiAssistantRequest>(AI_ASSISTANT_EVENT, { detail: { prompt, silent } }),
    );
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/** 订阅"打开助手"事件，返回取消订阅函数 */
export function onOpenAiAssistant(handler: (req: AiAssistantRequest) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<AiAssistantRequest>).detail ?? {});
  };
  window.addEventListener(AI_ASSISTANT_EVENT, listener);
  return () => window.removeEventListener(AI_ASSISTANT_EVENT, listener);
}

export const AI_ATTACH_EVENT = 'sm:ai-attach';

/** 让助手面板打开并直接弹出选文件对话框（供应商资料等） */
export function requestAiAttachment(): void {
  try {
    window.dispatchEvent(new Event(AI_ATTACH_EVENT));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/** 订阅"上传资料给 AI"事件 */
export function onRequestAiAttachment(handler: () => void): () => void {
  window.addEventListener(AI_ATTACH_EVENT, handler);
  return () => window.removeEventListener(AI_ATTACH_EVENT, handler);
}
