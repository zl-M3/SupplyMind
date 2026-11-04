import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Row, Segmented, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { StockOverviewRow } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { CATALOG_TABS } from './tabs';
import { StockLevelTag } from '@/components/StatusTag';
import { stockApi } from '@/services/api';
import { openAiAssistant } from '@/services/aiAssistant';
import { useRequest } from '@/hooks/useRequest';

export default function StockAlerts() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'out' | 'low'>('all');
  const { data, loading } = useRequest(() => stockApi.alerts(), []);

  const rows = useMemo(() => {
    const list = data ?? [];
    if (tab === 'out') return list.filter((r) => r.level === 'out');
    if (tab === 'low') return list.filter((r) => r.level === 'low');
    return list;
  }, [data, tab]);

  const outCount = (data ?? []).filter((r) => r.level === 'out').length;
  const lowCount = (data ?? []).filter((r) => r.level === 'low').length;

  const columns: ColumnsType<StockOverviewRow> = [
    {
      title: '商品',
      dataIndex: 'productName',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div className="sm-muted" style={{ fontSize: 12 }}>
            <span className="sm-mono">{row.productCode}</span> · {row.spec}
          </div>
        </div>
      ),
    },
    { title: '库存状态', dataIndex: 'level', width: 100, render: (v) => <StockLevelTag level={v} /> },
    {
      title: '当前库存',
      dataIndex: 'totalQty',
      width: 110,
      align: 'right',
      render: (v, row) => (
        <span style={{ color: row.level === 'out' ? '#d4380d' : '#d48806', fontWeight: 600 }}>{v}</span>
      ),
    },
    { title: '安全库存', dataIndex: 'safetyStock', width: 100, align: 'right' },
    {
      title: '缺口',
      dataIndex: 'gap',
      width: 90,
      align: 'right',
      render: (v) => <span style={{ color: '#d4380d', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: (
        <Tooltip title="建议采购量 = max(0, 安全库存 − 当前可用库存 − 已审批未收货数量)">
          <span style={{ borderBottom: '1px dashed #8a919f', cursor: 'help' }}>建议采购量</span>
        </Tooltip>
      ),
      dataIndex: 'suggestedQty',
      width: 120,
      align: 'right',
      render: (v, row) =>
        v > 0 ? (
          <Tag color="orange">
            {v} {row.unit}
          </Tag>
        ) : (
          <Tooltip title="已审批未收货数量已可覆盖安全库存">
            <Tag color="green">无需补货</Tag>
          </Tooltip>
        ),
    },
    {
      title: '在途',
      dataIndex: 'inTransitQty',
      width: 80,
      align: 'right',
      render: (v) => (v > 0 ? <Tag color="blue">{v}</Tag> : <span className="sm-muted">0</span>),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<RobotOutlined />}
            onClick={() => openAiAssistant(`${row.productName} 需要补多少货？`)}
          >
            AI 补货建议
          </Button>
          <Button type="link" size="small" onClick={() => navigate('/purchase/orders')}>
            去采购
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="库存预警"
        description="当前库存为 0 视为缺货，低于安全库存视为低库存；补货建议按首期公式计算，不做销量预测"
        extra={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() =>
              openAiAssistant('哪些商品库存不足？缺货的先算一下补货量，给出补货方案。')
            }
          >
            AI 生成补货方案
          </Button>
        }
      />

            <ModuleTabs items={CATALOG_TABS} />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="缺货商品" value={outCount} suffix="个" valueStyle={{ color: '#d4380d' }} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="低库存商品" value={lowCount} suffix="个" valueStyle={{ color: '#d48806' }} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic
              title="建议补货商品"
              value={(data ?? []).filter((r) => r.suggestedQty > 0).length}
              suffix="个"
            />
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="补货建议口径"
        description="建议采购量 = max(0, 安全库存目标 − 当前可用库存 − 已审批未收货数量)。首期不做复杂销量预测；没有销售历史数据时，不会让 AI 编造需求预测。"
      />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Segmented
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            options={[
              { label: `全部（${(data ?? []).length}）`, value: 'all' },
              { label: `缺货（${outCount}）`, value: 'out' },
              { label: `低库存（${lowCount}）`, value: 'low' },
            ]}
          />
          <div style={{ flex: 1 }} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            数据来自仓库库存汇总，收货/调拨后自动刷新
          </Typography.Text>
        </div>

        <Table<StockOverviewRow>
          rowKey="productId"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1080 }}
          locale={{ emptyText: '当前没有库存预警' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>
    </>
  );
}
