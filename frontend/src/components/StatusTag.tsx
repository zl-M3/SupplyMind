import React from 'react';
import { Tag } from 'antd';
import type { AgentTaskStatus, LogisticsStatus, PurchaseOrderStatus, StockLevel, SupplierStatus } from '@/types';
import { LOGISTICS_STATUS_LABEL, PO_STATUS_LABEL, STOCK_LEVEL_LABEL } from '@/services/rules';

const PO_COLOR: Record<PurchaseOrderStatus, string> = {
  draft: 'default',
  pending: 'orange',
  approved: 'blue',
  partial: 'cyan',
  completed: 'green',
  rejected: 'red',
  cancelled: 'default',
};

export function PoStatusTag({ status }: { status: PurchaseOrderStatus }) {
  return <Tag color={PO_COLOR[status]}>{PO_STATUS_LABEL[status]}</Tag>;
}

const LOG_COLOR: Record<LogisticsStatus, string> = {
  pending: 'default',
  in_transit: 'blue',
  arrived: 'cyan',
  delivered: 'green',
  exception: 'red',
};

export function LogisticsStatusTag({ status }: { status: LogisticsStatus }) {
  return <Tag color={LOG_COLOR[status]}>{LOGISTICS_STATUS_LABEL[status]}</Tag>;
}

const STOCK_COLOR: Record<StockLevel, string> = {
  out: 'red',
  low: 'orange',
  normal: 'green',
};

export function StockLevelTag({ level }: { level: StockLevel }) {
  return <Tag color={STOCK_COLOR[level]}>{STOCK_LEVEL_LABEL[level]}</Tag>;
}

const TASK_LABEL: Record<AgentTaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  waiting_confirm: '待确认',
  done: '已完成',
  failed: '失败',
};

const TASK_COLOR: Record<AgentTaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  waiting_confirm: 'orange',
  done: 'green',
  failed: 'red',
};

export function TaskStatusTag({ status }: { status: AgentTaskStatus }) {
  return <Tag color={TASK_COLOR[status]}>{TASK_LABEL[status]}</Tag>;
}

export function SupplierStatusTag({ status }: { status: SupplierStatus }) {
  return status === 'active' ? <Tag color="green">合作中</Tag> : <Tag>已停用</Tag>;
}

export function DelayedTag({ delayed }: { delayed: boolean }) {
  return delayed ? <Tag color="red">延迟</Tag> : <Tag color="green">正常</Tag>;
}
