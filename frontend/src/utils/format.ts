import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export const now = () => dayjs();
export const daysAgo = (n: number) => dayjs().subtract(n, 'day').toISOString();
export const daysLater = (n: number) => dayjs().add(n, 'day').toISOString();
export const hoursAgo = (n: number) => dayjs().subtract(n, 'hour').toISOString();

export const fmtDate = (v?: string | null) => (v ? dayjs(v).format('YYYY-MM-DD') : '-');
export const fmtDateTime = (v?: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-');
export const fromNow = (v?: string | null) => (v ? dayjs(v).fromNow() : '-');

export const fmtMoney = (v?: number | null) =>
  v == null ? '-' : `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtAmount = (v?: number | null) =>
  v == null ? '-' : `¥${Math.round(v).toLocaleString('zh-CN')}`;

export const fmtNum = (v?: number | null) => (v == null ? '-' : v.toLocaleString('zh-CN'));

export const fmtPercent = (v?: number | null) => (v == null ? '数据不足' : `${(v * 100).toFixed(1)}%`);

/** 生成业务单号：PO-20261101-001 */
export const makeCode = (prefix: string, seq: number) =>
  `${prefix}-${dayjs().format('YYYYMMDD')}-${String(seq).padStart(3, '0')}`;

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
