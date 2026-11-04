import React, { useState } from 'react';
import { Button, Input, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { LogisticsOrder } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { PURCHASE_TABS } from './tabs';
import { LogisticsStatusTag } from '@/components/StatusTag';
import { logisticsApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtDate } from '@/utils/format';

export default function Logistics() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [keyword, setKeyword] = useState(params.get('keyword') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [onlyDelayed, setOnlyDelayed] = useState(params.get('delayed') === '1');
  const [query, setQuery] = useState({
    keyword: params.get('keyword') ?? '',
    status: params.get('status') ?? '',
    onlyDelayed: params.get('delayed') === '1',
    page: 1,
    pageSize: 10,
  });

  const { data, loading, reload } = useRequest(
    () => logisticsApi.list(query),
    [query.keyword, query.status, query.onlyDelayed, query.page, query.pageSize],
  );

  const doSearch = () => {
    setQuery({ keyword, status, onlyDelayed, page: 1, pageSize: query.pageSize });
    setParams((p) => {
      const next = new URLSearchParams(p);
      keyword ? next.set('keyword', keyword) : next.delete('keyword');
      status ? next.set('status', status) : next.delete('status');
      onlyDelayed ? next.set('delayed', '1') : next.delete('delayed');
      return next;
    });
  };

  /** 条件没变时（只是想刷新一下）直接重新拉取，避免页面一直用旧数据 */
  const searchAndReload = () => {
    const same =
      query.keyword === keyword &&
      query.status === status &&
      query.onlyDelayed === onlyDelayed &&
      query.page === 1;
    doSearch();
    if (same) void reload();
  };

  const reset = () => {
    setKeyword('');
    setStatus('');
    setOnlyDelayed(false);
    setQuery({ keyword: '', status: '', onlyDelayed: false, page: 1, pageSize: 10 });
    setParams(new URLSearchParams());
  };

  const columns: ColumnsType<LogisticsOrder> = [
    {
      title: '物流单号',
      dataIndex: 'code',
      width: 176,
      render: (v, row) => (
        <a className="sm-mono" onClick={() => navigate(`/purchase/logistics/${row.id}`)}>
          {v}
        </a>
      ),
    },
    {
      title: '关联采购单',
      dataIndex: 'poCode',
      width: 172,
      render: (v, row) => (
        <a className="sm-mono" onClick={() => navigate(`/purchase/orders/${row.poId}`)}>
          {v}
        </a>
      ),
    },
    { title: '供应商', dataIndex: 'supplierName', ellipsis: true },
    { title: '承运商', dataIndex: 'carrier', width: 100 },
    { title: '预计到达', dataIndex: 'expectedArrival', width: 110, render: (v) => fmtDate(v) },
    {
      title: '当前状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => <LogisticsStatusTag status={v} />,
    },
    {
      title: '是否延迟',
      dataIndex: 'delayed',
      width: 96,
      render: (v: boolean) => (v ? <Tag color="red">延迟</Tag> : <Tag color="green">正常</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => navigate(`/purchase/logistics/${row.id}`)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="物流跟踪"
        description="物流数据由采购订单审批通过后自动生成；超过预计到达时间且未送达自动标记延迟"
      />

            <ModuleTabs items={PURCHASE_TABS} />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            style={{ width: 240 }}
            placeholder="搜索物流单号 / 运单号 / 采购单号"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={doSearch}
          />
          <Select
            allowClear
            style={{ width: 130 }}
            placeholder="物流状态"
            value={status || undefined}
            onChange={(v) => setStatus(v ?? '')}
            options={[
              { label: '待发货', value: 'pending' },
              { label: '运输中', value: 'in_transit' },
              { label: '已到达', value: 'arrived' },
              { label: '已签收', value: 'delivered' },
              { label: '异常', value: 'exception' },
            ]}
          />
          <Space size={6}>
            <Switch size="small" checked={onlyDelayed} onChange={setOnlyDelayed} />
            <span style={{ fontSize: 13 }}>只看延迟</span>
          </Space>
          <Button type="primary" onClick={searchAndReload}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={reset}>
            重置
          </Button>
        </div>

        <Table<LogisticsOrder>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.list ?? []}
          scroll={{ x: 1180 }}
          locale={{ emptyText: '没有符合条件的物流单' }}
          rowClassName={(row) => (row.delayed ? 'sm-row-delayed' : '')}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (page, pageSize) => setQuery((q) => ({ ...q, page, pageSize })),
          }}
        />
      </div>
    </>
  );
}
