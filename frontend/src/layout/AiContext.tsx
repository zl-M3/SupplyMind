import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AiPageContext } from '@/types';
import AiDrawer from './AiDrawer';

interface AiContextValue {
  visible: boolean;
  context?: AiPageContext;
  presetQuestion?: string;
  open: (context?: AiPageContext, presetQuestion?: string) => void;
  close: () => void;
}

const AiCtx = createContext<AiContextValue | null>(null);

/**
 * 全局 AI 助手：任意业务页面都可以唤起，并携带页面上下文。
 * 页面上下文只用于帮助 Agent 理解意图，权限与数据校验仍以服务端为准。
 */
export function AiProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [context, setContext] = useState<AiPageContext>();
  const [presetQuestion, setPresetQuestion] = useState<string>();
  const [seed, setSeed] = useState(0);

  const open = useCallback((ctx?: AiPageContext, question?: string) => {
    setContext(ctx);
    setPresetQuestion(question);
    setSeed((s) => s + 1);
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const value = useMemo(
    () => ({ visible, context, presetQuestion, open, close }),
    [visible, context, presetQuestion, open, close],
  );

  return (
    <AiCtx.Provider value={value}>
      {children}
      <AiDrawer
        key={seed}
        open={visible}
        context={context}
        presetQuestion={presetQuestion}
        onClose={close}
      />
    </AiCtx.Provider>
  );
}

export function useAi() {
  const ctx = useContext(AiCtx);
  if (!ctx) throw new Error('useAi 必须在 AiProvider 内使用');
  return ctx;
}
