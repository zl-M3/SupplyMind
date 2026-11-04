import React from 'react';
import { NumberTicker } from './magic/NumberTicker';

export type Tone = 'orange' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  orange: { bg: 'var(--sm-primary-soft)', fg: 'var(--sm-primary)' },
  green: { bg: 'var(--sm-green-soft)', fg: 'var(--sm-green)' },
  amber: { bg: 'var(--sm-amber-soft)', fg: 'var(--sm-amber)' },
  red: { bg: 'var(--sm-red-soft)', fg: 'var(--sm-red)' },
  blue: { bg: 'var(--sm-blue-soft)', fg: 'var(--sm-blue)' },
  violet: { bg: 'var(--sm-violet-soft)', fg: 'var(--sm-violet)' },
};

export function IconChip({
  icon,
  tone = 'orange',
  size = 34,
}: {
  icon: React.ReactNode;
  tone?: Tone;
  size?: number;
}) {
  const t = TONE[tone];
  return (
    <span
      className="sm-kpi-icon"
      style={{ width: size, height: size, background: t.bg, color: t.fg, borderRadius: size * 0.3 }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  icon: React.ReactNode;
  tone?: Tone;
  /** 环比 */
  trend?: { dir: 'up' | 'down'; text: string };
  hint?: string;
  onClick?: () => void;
}

/**
 * KPI 卡片：图标胶囊 + 标签 + 滚动数字 + 环比。
 * 对应参考图工作台的五个指标卡。
 */
export function StatCard({
  label,
  value,
  prefix,
  suffix,
  decimals = 0,
  icon,
  tone = 'orange',
  trend,
  hint,
  onClick,
}: StatCardProps) {
  return (
    <div
      className="sm-kpi"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="sm-kpi-head">
        <IconChip icon={icon} tone={tone} />
        <span className="sm-kpi-label">{label}</span>
      </div>
      <div className="sm-kpi-value">
        <NumberTicker value={value} decimals={decimals} prefix={prefix} />
        {suffix && <span className="sm-kpi-suffix">{suffix}</span>}
      </div>
      <div className="sm-kpi-foot">
        {trend && (
          <span className={`sm-trend sm-trend--${trend.dir}`}>
            {trend.dir === 'up' ? '↑' : '↓'} {trend.text}
          </span>
        )}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

export default StatCard;
