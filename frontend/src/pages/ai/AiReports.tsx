import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Descriptions, Drawer, Modal, Segmented, Space, Switch, Table, Tag, TimePicker, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AiReport, AiReportType } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { AI_TABS } from './tabs';
import { reportApi, reportScheduleApi, optimizeApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtDateTime } from '@/utils/format';
import { downloadExport } from '@/utils/download';

const TYPE_LABEL: Record<AiReportType, { text: string; color: string }> = {
  supplier_risk: { text: '供应商风险', color: 'orange' },
  replenishment: { text: '库存补货', color: 'blue' },
  logistics_anomaly: { text: '物流异常', color: 'red' },
};

export default function AiReports() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<string>('all');
  const [activeId, setActiveId] = useState<string>();
  const { data, loading } = useRequest(() => reportApi.list(), []);
  const [detail, setDetail] = useState<AiReport | null>(null);
  const [schedule, setSchedule] = useState<{ enabled: boolean; daily_time: string }>({
    enabled: false,
    daily_time: '08:30',
  });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimize, setOptimize] = useState<Awaited<ReturnType<typeof optimizeApi.replenishment>> | null>(
    null,
  );

  const runOptimize = async () => {
    setOptimizeOpen(true);
    setOptimizing(true);
    try {
      setOptimize(await optimizeApi.replenishment());
    } catch (e) {
      message.error(e instanceof Error ? e.message : '优化失败');
    } finally {
      setOptimizing(false);
    }
  };

  useEffect(() => {
    reportScheduleApi
      .get()
      .then((res) => setSchedule({ enabled: res.enabled, daily_time: res.daily_time }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    reportApi
      .get(activeId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const saveSchedule = async (next: { enabled: boolean; daily_time: string }) => {
    setSchedule(next);
    setScheduleSaving(true);
    try {
      await reportScheduleApi.save(next.enabled, next.daily_time);
      message.success('定时设置已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setScheduleSaving(false);
    }
  };

  const rows = useMemo(() => {
    const list = data ?? [];
    if (tab === 'all') return list;
    return list.filter((r) => r.type === tab);
  }, [data, tab]);

  const activeBrief = useMemo(() => data?.find((r) => r.id === activeId), [data, activeId]);
  const active = detail ?? activeBrief;

  const copy = async (r: AiReport) => {
    const text = [
      r.title,
      `分析时间：${fmtDateTime(r.createdAt)}`,
      '',
      `结论：${r.conclusion}`,
      '',
      '数据依据：',
      ...r.evidence.map((e) => `- ${e.label}：${e.value}`),
      '',
      `原因分析：${r.cause}`,
      '',
      '建议动作：',
      ...r.suggestions.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success('报告已复制到剪贴板');
    } catch {
      message.warning('当前浏览器不支持自动复制，请手动选中复制');
    }
  };

  const columns: ColumnsType<AiReport> = [
    {
      title: '报告标题',
      dataIndex: 'title',
      render: (v, row) => (
        <a style={{ fontWeight: 500 }} onClick={() => setActiveId(row.id)}>
          {v}
        </a>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (v: AiReportType) => <Tag color={TYPE_LABEL[v].color}>{TYPE_LABEL[v].text}</Tag>,
    },
    { title: '关联对象', dataIndex: 'targetName', width: 220, ellipsis: true },
    { title: '分析时间', dataIndex: 'createdAt', width: 152, render: (v) => fmtDateTime(v) },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setActiveId(row.id)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => void copy(row)}>
            复制
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="AI 分析报告"
        description="保存供应商风险、库存补货与物流异常的分析结果；首期为可查看、可复制的结构化报告"
      />

            <ModuleTabs items={AI_TABS} />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space size={16} wrap>
          <span style={{ fontSize: 13 }}>每天自动生成报告</span>
          <Switch
            checked={schedule.enabled}
            loading={scheduleSaving}
            onChange={(checked) => void saveSchedule({ ...schedule, enabled: checked })}
          />
          <TimePicker
            size="small"
            format="HH:mm"
            allowClear={false}
            value={dayjs(schedule.daily_time, 'HH:mm')}
            onChange={(value) => {
              if (!value) return;
              void saveSchedule({ ...schedule, daily_time: value.format('HH:mm') });
            }}
          />
          <span style={{ fontSize: 12, color: '#a2968a' }}>
            每天到点自动生成库存补货、采购、供应商三份分析报告
          </span>
        </Space>
      </Card>

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Segmented
            value={tab}
            onChange={(v) => setTab(v as string)}
            options={[
              { label: `全部（${(data ?? []).length}）`, value: 'all' },
              { label: '物流异常', value: 'logistics_anomaly' },
              { label: '库存补货', value: 'replenishment' },
              { label: '供应商风险', value: 'supplier_risk' },
            ]}
          />
          <div style={{ flex: 1 }} />
          <Button onClick={() => void runOptimize()}>补货比价优化</Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              downloadExport('/export/ai-reports.xlsx', 'AI分析报告.xlsx').catch((e) =>
                message.error(e instanceof Error ? e.message : '导出失败'),
              );
            }}
          >
            导出 Excel
          </Button>
        </div>
        <Table<AiReport>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 980 }}
          locale={{ emptyText: '还没有分析报告，可以让 AI 助手分析一次物流异常' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>

      <Drawer
        title={
          <Space>
            <FileTextOutlined style={{ color: '#2f54eb' }} />
            报告详情
          </Space>
        }
        width={680}
        open={!!activeId}
        onClose={() => setActiveId(undefined)}
        extra={
          active && (
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(active)}>
              复制全文
            </Button>
          )
        }
      >
        {!active ? null : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Typography.Title level={5} style={{ marginBottom: 4 }}>
                {active.title}
              </Typography.Title>
              <Space size={8}>
                <Tag color={TYPE_LABEL[active.type].color}>{TYPE_LABEL[active.type].text}</Tag>
                <span className="sm-muted" style={{ fontSize: 12 }}>
                  分析时间 {fmtDateTime(active.createdAt)} · 关联对象 {active.targetName}
                </span>
              </Space>
            </div>

            <Card size="small" title="结论">
              <Typography.Text strong>{active.conclusion}</Typography.Text>
            </Card>

            <Card size="small" title="数据依据">
              <Descriptions column={1} size="small" colon={false} styles={{ label: { color: '#8a919f', width: 100 } }}>
                {active.evidence.map((e, idx) => (
                  <Descriptions.Item key={idx} label={e.label}>
                    {e.value}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>

            <Card size="small" title="原因分析">
              <Typography.Paragraph style={{ marginBottom: 0 }}>{active.cause}</Typography.Paragraph>
            </Card>

            <Card size="small" title="建议动作">
              <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                {active.suggestions.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ol>
            </Card>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              报告由 Agent 基于当前业务数据生成；执行建议动作仍需在业务页面人工操作并经过后端校验。
            </Typography.Text>
          </Space>
        )}
      </Drawer>

      <Modal
        title="补货比价选商"
        open={optimizeOpen}
        onCancel={() => setOptimizeOpen(false)}
        footer={null}
        width={760}
        destroyOnClose
      >
        {optimizing ? (
          <div style={{ padding: 24, textAlign: 'center' }}>正在按历史采购价测算…</div>
        ) : !optimize ? (
          <div style={{ padding: 24, textAlign: 'center' }}>暂无需要补货的商品</div>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              预计采购金额 <b>¥{optimize.total_cost.toFixed(2)}</b>，按目录价基准可省{' '}
              <b style={{ color: '#16a34a' }}>¥{optimize.savings.toFixed(2)}</b>
            </div>
            <Table
              size="small"
              rowKey="product_id"
              pagination={false}
              dataSource={optimize.plan}
              columns={[
                { title: '商品', dataIndex: 'product_name' },
                { title: '缺口', dataIndex: 'qty', width: 80 },
                {
                  title: '建议供应商',
                  dataIndex: ['best', 'supplier_name'],
                  width: 200,
                },
                {
                  title: '单价',
                  dataIndex: ['best', 'price'],
                  width: 90,
                  render: (v: number) => `¥${v}`,
                },
                {
                  title: '金额',
                  dataIndex: 'cost',
                  width: 110,
                  render: (v: number) => `¥${v.toFixed(2)}`,
                },
                {
                  title: '较目录价省',
                  dataIndex: 'savings',
                  width: 110,
                  render: (v: number) => `¥${v.toFixed(2)}`,
                },
              ]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {optimize.note}
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </>
  );
}
