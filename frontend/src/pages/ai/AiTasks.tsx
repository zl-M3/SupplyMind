import React, { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import type { AgentTask, AgentTaskType } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { AI_TABS } from './tabs';
import { TaskStatusTag } from '@/components/StatusTag';
import AiReplyView from '@/components/AiReplyView';
import MockDataNotice from '@/components/MockDataNotice';
import { taskApi } from '@/mock/agent';
import { useRequest } from '@/hooks/useRequest';
import { fmtDateTime } from '@/utils/format';

const TYPE_LABEL: Record<AgentTaskType, string> = {
  replenishment: '库存补货',
  logistics_analysis: '物流异常分析',
  supplier_analysis: '供应商分析',
  purchase_draft: '采购草稿',
};

export default function AiTasks() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<string>('all');
  const { data, loading, reload } = useRequest(() => taskApi.list(), []);

  const [activeId, setActiveId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = useMemo(() => data?.find((t) => t.id === activeId), [data, activeId]);

  const rows = useMemo(() => {
    const list = data ?? [];
    if (tab === 'all') return list;
    return list.filter((t) => t.status === tab);
  }, [data, tab]);

  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      all: list.length,
      waiting_confirm: list.filter((t) => t.status === 'waiting_confirm').length,
      running: list.filter((t) => t.status === 'running').length,
      done: list.filter((t) => t.status === 'done').length,
      failed: list.filter((t) => t.status === 'failed').length,
    };
  }, [data]);

  const doAction = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      message.success(okText);
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AgentTask> = [
    {
      title: '任务名称',
      dataIndex: 'name',
      render: (v, row) => (
        <a style={{ fontWeight: 500 }} onClick={() => setActiveId(row.id)}>
          {v}
        </a>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (v: AgentTaskType) => <Tag>{TYPE_LABEL[v]}</Tag>,
    },
    { title: '发起人', dataIndex: 'createdBy', width: 90 },
    { title: '创建时间', dataIndex: 'createdAt', width: 152, render: (v) => fmtDateTime(v) },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <TaskStatusTag status={v} /> },
    {
      title: '结果摘要',
      dataIndex: 'summary',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12.5, color: '#5a6272' }}>{v}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setActiveId(row.id)}>
          {row.status === 'waiting_confirm' ? '去确认' : '查看详情'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent 任务中心"
        description="Agent 每次调用工具都会留下任务记录；涉及写入的动作一律停在「待确认」，由人工放行"
        extra={
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
        }
      />

            <ModuleTabs items={AI_TABS} />

      <MockDataNotice scope="Agent 任务中心" />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Segmented
            value={tab}
            onChange={(v) => setTab(v as string)}
            options={[
              { label: `全部（${counts.all}）`, value: 'all' },
              { label: `待确认（${counts.waiting_confirm}）`, value: 'waiting_confirm' },
              { label: `执行中（${counts.running}）`, value: 'running' },
              { label: `已完成（${counts.done}）`, value: 'done' },
              { label: `失败（${counts.failed}）`, value: 'failed' },
            ]}
          />
        </div>
        <Table<AgentTask>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1080 }}
          locale={{ emptyText: '没有符合条件的任务' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>

      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: '#2f54eb' }} />
            {active?.name ?? '任务详情'}
          </Space>
        }
        width={640}
        open={!!activeId}
        onClose={() => setActiveId(undefined)}
      >
        {!active ? (
          <Empty />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={2} size="small" colon={false} styles={{ label: { color: '#8a919f', width: 76 } }}>
              <Descriptions.Item label="任务编号">
                <span className="sm-mono">{active.id}</span>
              </Descriptions.Item>
              <Descriptions.Item label="类型">{TYPE_LABEL[active.type]}</Descriptions.Item>
              <Descriptions.Item label="发起人">{active.createdBy}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmtDateTime(active.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <TaskStatusTag status={active.status} />
              </Descriptions.Item>
              <Descriptions.Item label="工具调用">{active.toolCalls.length} 次</Descriptions.Item>
              <Descriptions.Item label="摘要" span={2}>
                {active.summary}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="工具调用摘要">
              <Table
                rowKey={(r) => `${r.name}-${r.params}`}
                size="small"
                pagination={false}
                dataSource={active.toolCalls}
                columns={[
                  {
                    title: '工具',
                    dataIndex: 'name',
                    render: (v) => <span className="sm-mono">{v}</span>,
                  },
                  {
                    title: '参数摘要',
                    dataIndex: 'params',
                    render: (v) => (
                      <Typography.Text className="sm-mono" style={{ fontSize: 11.5 }} ellipsis={{ tooltip: v }}>
                        {v}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 80,
                    render: (v) => (v === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>),
                  },
                  {
                    title: '耗时',
                    dataIndex: 'durationMs',
                    width: 84,
                    align: 'right',
                    render: (v) => `${v}ms`,
                  },
                ]}
              />
            </Card>

            {active.error && (
              <Card size="small" title="错误原因">
                <Typography.Text type="danger">{active.error}</Typography.Text>
              </Card>
            )}

            {active.resultText && (
              <Card size="small" title="执行结果">
                {active.resultText}
              </Card>
            )}

            {active.status === 'waiting_confirm' && active.payload && (
              <Card size="small" title="待确认操作">
                <AiReplyView
                  reply={{
                    conclusion: '以下采购草稿需要你确认后才会真正创建，创建后不会自动审批。',
                    evidence: [],
                    actions: [],
                    draft: active.payload,
                    toolCalls: active.toolCalls,
                  }}
                  onCreated={() => {
                    reload();
                  }}
                />
                <div style={{ marginTop: 12 }}>
                  <Button
                    danger
                    size="small"
                    loading={busy}
                    onClick={() =>
                      void doAction(async () => {
                        await taskApi.cancel(active.id);
                        setActiveId(undefined);
                      }, '任务已取消')
                    }
                  >
                    取消该任务
                  </Button>
                </div>
              </Card>
            )}

            {active.status === 'failed' && (
              <Button
                type="primary"
                loading={busy}
                onClick={() => void doAction(() => taskApi.retry(active.id), '任务已重试并完成')}
              >
                重试任务
              </Button>
            )}
          </Space>
        )}
      </Drawer>
    </>
  );
}
