import { useCallback, useEffect, useRef, useState } from 'react';
import { onChange } from '@/mock/db';

interface Options {
  /** 数据变化时自动重新拉取（默认 true） */
  autoRefresh?: boolean;
}

/**
 * 极简数据请求 Hook：加载态 / 错误态 / 手动刷新 / 数据变更自动刷新
 *
 * 换成 react-query 或 swr 时，页面只需要改 hook 名。
 */
export function useRequest<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: Options = {},
) {
  const { autoRefresh = true } = options;
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seqRef = useRef(0);

  const run = useCallback(async (silent = false) => {
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      const result = await fetcherRef.current();
      if (seq === seqRef.current) setData(result);
    } catch (e) {
      if (seq === seqRef.current) setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!autoRefresh) return;
    return onChange(() => void run(true));
  }, [autoRefresh, run]);

  /**
   * 回到这个页面/标签页时自动重取数据。
   *
   * 典型场景：在 Navicat / SQL 工具里改了库里的数据，切回浏览器时
   * 页面应该自动是最新的，而不是停留在打开时的那一份。
   */
  useEffect(() => {
    if (!autoRefresh) return;
    let lastAt = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAt < 1500) return; // focus 与 visibilitychange 会同时触发，去重
      lastAt = now;
      void run(true);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [autoRefresh, run]);

  return { data, loading, error, reload: () => run(), reset: () => setData(undefined) };
}
