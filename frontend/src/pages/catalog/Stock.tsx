import React, { useMemo, useState } from 'react';
import { App, Button, Card, Col, Input, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DatabaseOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import type { StockOverviewRow } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import EChart from '@/components/EChart';
import StatCard from '@/components/StatCard';
import { StockLevelTag } from '@/components/StatusTag';
import { stockApi, warehouseApi } from '@/services/api';
import { downloadExport } from '@/utils/download';
import { openAiAssistant } from '@/services/aiAssistant';
import { useRequest } from '@/hooks/useRequest';
import { CATALOG_TABS } from './tabs';

export default function Stock() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [keyword, setKeyword] = useState(params.get('keyword') ?? '');
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '');
  const [level, setLevel] = useState(params.get('level') ?? '');
  const [query, setQuery] = useState({
    keyword: params.get('keyword') ?? '',
    warehouseId: params.get('warehouseId') ?? '',
    level: params.get('level') ?? '',
  });

  const { data, loading, reload } = useRequest(
    () => stockApi.overview(query),
    [query.keyword, query.warehouseId, query.level],
  );
  const { data: warehouses } = useRequest(() => warehouseApi.list(), []);

  const doSearch = () => {
    setQuery({ keyword, warehouseId, level });
    setParams((p) => {
      const next = new URLSearchParams(p);
      keyword ? next.set('keyword', keyword) : next.delete('keyword');
      warehouseId ? next.set('warehouseId', warehouseId) : next.delete('warehouseId');
      level ? next.set('level', level) : next.delete('level');
      return next;
    });
  };

  /** 条件没变时（只是想刷新一下）直接重新拉取，避免页面一直用旧数据 */
  const searchAndReload = () => {
    const same = query.keyword === keyword && query.warehouseId === warehouseId && query.level === level;
    doSearch();
    if (same) void reload();
  };

  const rows = data ?? [];

  const stat = useMemo(() => {
    const totalQty = rows.reduce((s, r) => s + r.totalQty, 0);
    const lowCount = rows.filter((r) => r.level !== 'normal').length;
    const byWarehouse = new Map<string, { name: string; qty: number }>();
    rows.forEach((r) =>
      r.warehouses.forEach((w) => {
        const prev = byWarehouse.get(w.warehouseId) ?? { name: w.warehouseName, qty: 0 };
        byWarehouse.set(w.warehouseId, { name: w.warehouseName, qty: prev.qty + w.qty });
      }),
    );
    const top = [...rows].sort((a, b) => b.totalQty - a.totalQty).slice(0, 5);
    return {
      totalQty,
      lowCount,
      distribution: [...byWarehouse.values()].sort((a, b) => b.qty - a.qty),
      top,
    };
  }, [rows]);

  const donutOption = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(31,27,22,.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: '{b}<br/>{c} 件（{d}%）',
      },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#8a8175', fontSize: 11.5 },
      },
      color: ['#3b82f6', '#f26522', '#fbbf24', '#a78bfa'],
      series: [
        {
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
          label: {
            show: true,
            position: 'center',
            formatter: () => `{a|${stat.totalQty.toLocaleString('zh-CN')}}\n{b|总库存}`,
            rich: {
              a: { fontSize: 20, fontWeight: 700, color: '#1f1b16', lineHeight: 28 },
              b: { fontSize: 11.5, color: '#8a8175' },
            },
          },
          emphasis: {
            label: { show: true },
          },
          labelLine: { show: false },
          data: stat.distribution.map((d) => ({ name: d.name, value: d.qty })),
        },
      ],
    }),
    [stat],
  );

  const columns: ColumnsType<StockOverviewRow> = [
    {
      title: '商品',
      dataIndex: 'productName',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div className="sm-muted" style={{ fontSize: 12 }}>
            <span className="sm-mono">{row.productCode}</span> · {row.category}
          </div>
        </div>
      ),
    },
    { title: '规格', dataIndex: 'spec', width: 160, render: (v) => <span className="sm-muted">{v}</span> },
    { title: '安全库存', dataIndex: 'safetyStock', width: 100, align: 'right' },
    {
      title: '总库存',
      dataIndex: 'totalQty',
      width: 110,
      align: 'right',
      render: (v, row) => (
        <span style={{ fontWeight: 600, color: row.level === 'out' ? '#d4380d' : undefined }}>
          {v} <span className="sm-muted" style={{ fontWeight: 400, fontSize: 12 }}>{row.unit}</span>
        </span>
      ),
    },
    {
      title: '在途',
      dataIndex: 'inTransitQty',
      width: 90,
      align: 'right',
      render: (v) => (v > 0 ? <Tag color="blue">{v}</Tag> : <span className="sm-muted">0</span>),
    },
    { title: '库存状态', dataIndex: 'level', width: 104, render: (v) => <StockLevelTag level={v} /> },
    {
      title: '缺口',
      dataIndex: 'gap',
      width: 90,
      align: 'right',
      render: (v) => (v > 0 ? <span style={{ color: '#d4380d' }}>{v}</span> : <span className="sm-muted">0</span>),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          icon={<RobotOutlined />}
          onClick={() => openAiAssistant(`${row.productName} 需要补多少货？`)}
        >
          AI 补货建议
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="库存总览"
        description="展示商品总库存与各仓库分布；点击行首箭头查看仓库明细"
        extra={
          <Button type="primary" onClick={() => navigate('/catalog/alerts')}>
            查看库存预警
          </Button>
        }
      />

      <ModuleTabs items={CATALOG_TABS} />

      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <StatCard
          label="商品总数"
          value={rows.length}
          suffix="个"
          icon={<ExperimentOutlined />}
          tone="orange"
          hint="在售商品"
          onClick={() => navigate('/catalog/products')}
        />
        <StatCard
          label="库存总量"
          value={stat.totalQty}
          icon={<DatabaseOutlined />}
          tone="amber"
          hint="全部仓库合计"
        />
        <StatCard
          label="低库存商品"
          value={stat.lowCount}
          suffix="个"
          icon={<WarningOutlined />}
          tone="red"
          hint="含缺货"
          onClick={() => navigate('/catalog/alerts')}
        />
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={10}>
          <Card title="库存分布" size="small" styles={{ body: { paddingTop: 8 } }}>
            <EChart option={donutOption} height={252} />
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="热门商品 TOP5" size="small" extra={<span className="sm-muted" style={{ fontSize: 12 }}>按库存量排序</span>}>
            {stat.top.length === 0 ? (
              <div className="sm-empty">暂无数据</div>
            ) : (
              stat.top.map((row, idx) => (
                <div className="sm-stat-line" key={row.productId}>
                  <Space size={10}>
                    <span className={`sm-rank ${idx === 0 ? 'sm-rank--top' : ''}`}>{idx + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{row.productName}</div>
                      <div className="sm-muted" style={{ fontSize: 11.5 }}>
                        {row.spec} · {row.category}
                      </div>
                    </div>
                  </Space>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {row.totalQty.toLocaleString('zh-CN')}
                    <span className="sm-muted" style={{ fontSize: 11.5, fontWeight: 400, marginLeft: 3 }}>
                      {row.unit}
                    </span>
                  </span>
                </div>
              ))
            )}
          </Card>
        </Col>
      </Row>

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            style={{ width: 240 }}
            placeholder="搜索商品名称 / 编号"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={doSearch}
          />
          <Select
            allowClear
            style={{ width: 170 }}
            placeholder="仓库"
            value={warehouseId || undefined}
            onChange={(v) => setWarehouseId(v ?? '')}
            options={(warehouses ?? []).map((w) => ({ label: w.name, value: w.id }))}
          />
          <Select
            allowClear
            style={{ width: 130 }}
            placeholder="库存状态"
            value={level || undefined}
            onChange={(v) => setLevel(v ?? '')}
            options={[
              { label: '缺货', value: 'out' },
              { label: '低库存', value: 'low' },
              { label: '正常', value: 'normal' },
            ]}
          />
          <Button type="primary" onClick={searchAndReload}>
            查询
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setKeyword('');
              setWarehouseId('');
              setLevel('');
              setQuery({ keyword: '', warehouseId: '', level: '' });
              setParams(new URLSearchParams());
            }}
          >
            重置
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              downloadExport('/export/inventory.xlsx', '库存总览.xlsx', {
                keyword: query.keyword,
              }).catch((e) => message.error(e instanceof Error ? e.message : '导出失败'));
            }}
          >
            导出 Excel
          </Button>
        </div>

        <Table<StockOverviewRow>
          rowKey="productId"
          loading={loading}
          columns={columns}
          dataSource={data ?? []}
          scroll={{ x: 1080 }}
          locale={{ emptyText: '没有符合条件的库存记录' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          expandable={{
            expandedRowRender: (row) => (
              <div style={{ padding: '4px 8px' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  各仓库库存分布
                </Typography.Text>
                <Space size={24} wrap style={{ marginTop: 8, display: 'flex' }}>
                  {row.warehouses.map((w) => (
                    <div key={w.warehouseId}>
                      <div className="sm-muted" style={{ fontSize: 12 }}>
                        {w.warehouseName}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>
                        {w.qty}
                        <span className="sm-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                          {' '}
                          {row.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div>
                    <div className="sm-muted" style={{ fontSize: 12 }}>
                      建议采购量
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: row.suggestedQty > 0 ? '#d4380d' : '#389e0d' }}>
                      {row.suggestedQty}
                      <span className="sm-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                        {' '}
                        {row.unit}
                      </span>
                    </div>
                  </div>
                </Space>
              </div>
            ),
          }}
        />
      </div>
    </>
  );
}
