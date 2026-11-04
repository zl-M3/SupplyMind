import React from 'react';
import { Alert, Button, Card, Col, Descriptions, Progress, Row, Space, Statistic, Table, Tag } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { PurchaseOrder } from '@/types';
import PageHeader from '@/components/PageHeader';
import { PoStatusTag, SupplierStatusTag } from '@/components/StatusTag';
import { supplierApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtAmount, fmtDate, fmtDateTime, fmtPercent } from '@/utils/format';

export default function SupplierDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data: supplier, loading } = useRequest(() => supplierApi.get(id), [id]);
  const { data: metrics } = useRequest(() => supplierApi.metrics(id), [id]);
  const { data: orders } = useRequest(() => supplierApi.orders(id), [id]);

  const columns: ColumnsType<PurchaseOrder> = [
    {
      title: '订单编号',
      dataIndex: 'code',
      render: (v, row) => (
        <a className="sm-mono" onClick={() => navigate(`/purchase/orders/${row.id}`)}>
          {v}
        </a>
      ),
    },
    { title: '金额', dataIndex: 'totalAmount', align: 'right', render: (v) => fmtAmount(v) },
    { title: '状态', dataIndex: 'status', render: (v) => <PoStatusTag status={v} /> },
    { title: '预计到货', dataIndex: 'expectedArrival', render: (v) => fmtDate(v) },
    { title: '创建时间', dataIndex: 'createdAt', render: (v) => fmtDate(v) },
  ];

  return (
    <>
      <PageHeader
        title={loading ? '加载中…' : supplier?.name ?? '供应商详情'}
        description={`供应商编号 ${supplier?.code ?? '-'}`}
        backTo="/purchase/suppliers"
        backText="返回供应商列表"
        extra={
          <Button type="primary" onClick={() => navigate(`/purchase/orders?supplierId=${id}`)}>
            查看全部采购订单
          </Button>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={14}>
          <Card title="基础资料" size="small">
            <Descriptions column={2} size="small" colon={false} styles={{ label: { color: '#8a919f', width: 84 } }}>
              <Descriptions.Item label="名称">{supplier?.name}</Descriptions.Item>
              <Descriptions.Item label="编号">
                <span className="sm-mono">{supplier?.code}</span>
              </Descriptions.Item>
              <Descriptions.Item label="联系人">{supplier?.contact}</Descriptions.Item>
              <Descriptions.Item label="电话">
                <span className="sm-mono">{supplier?.phone}</span>
              </Descriptions.Item>
              <Descriptions.Item label="合作状态">
                {supplier && <SupplierStatusTag status={supplier.status} />}
              </Descriptions.Item>
              <Descriptions.Item label="主营大类">
                <Space size={4} wrap>
                  {supplier?.categories.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>
                {supplier?.address}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {supplier?.remark ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间" span={2}>
                {fmtDateTime(supplier?.createdAt)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card title="履约指标" size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="关联订单" value={metrics?.orderCount ?? 0} suffix="单" />
              </Col>
              <Col span={8}>
                <Statistic title="已完成" value={metrics?.completedCount ?? 0} suffix="单" />
              </Col>
              <Col span={8}>
                <Statistic
                  title="延迟"
                  value={metrics?.delayCount ?? 0}
                  suffix="单"
                  valueStyle={{ color: '#d4380d' }}
                />
              </Col>
            </Row>
            <div style={{ marginTop: 18 }}>
              <div className="sm-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                准时交付率
              </div>
              {metrics?.onTimeRate == null ? (
                <Alert
                  type="info"
                  showIcon
                  message="数据不足"
                  description="还没有已签收的采购订单，暂无法计算准时交付率；交付 1 单后即可统计。"
                />
              ) : (
                <>
                  <Progress
                    percent={Math.round(metrics.onTimeRate * 100)}
                    strokeColor={metrics.onTimeRate < 0.8 ? '#d4380d' : '#389e0d'}
                  />
                  <div className="sm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    统计口径：已完成订单 {metrics.completedCount} 单，其中延迟 {metrics.delayCount} 单 ⇒{' '}
                    {fmtPercent(metrics.onTimeRate)}
                  </div>
                </>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Card title={`关联采购订单（${orders?.length ?? 0}）`} size="small">
        <Table<PurchaseOrder>
          rowKey="id"
          size="small"
          loading={!orders}
          columns={columns}
          dataSource={orders ?? []}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: '该供应商暂无采购订单' }}
        />
      </Card>
    </>
  );
}
