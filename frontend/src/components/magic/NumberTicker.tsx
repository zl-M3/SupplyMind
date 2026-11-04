import { useEffect, useRef, useState } from 'react';

interface NumberTickerProps {
  value: number;
  /** 小数位，默认 0 */
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

/**
 * NumberTicker（Magic UI 等价实现）
 *
 * Magic UI 官方版依赖 framer-motion；这里用 requestAnimationFrame + easeOutExpo
 * 实现同样的"进入视口时数字滚动"行为，且尊重 prefers-reduced-motion。
 */
export function NumberTicker({
  value,
  decimals = 0,
  duration = 900,
  prefix = '',
  suffix = '',
  className,
}: NumberTickerProps) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [display, setDisplay] = useState(reduce ? value : 0);
  const fromRef = useRef(reduce ? value : 0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const next = from + (value - from) * easeOutExpo(progress);
      setDisplay(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduce]);

  const text = display.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

export default NumberTicker;
