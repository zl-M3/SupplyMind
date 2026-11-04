import React, { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { NodeIndexOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { PurchaseOrderItem } from '@/types';
import PageHeader from '@/components/PageHeader';
import { LogisticsStatusTag } from '@/components/StatusTag';
import { logisticsApi, purchaseOrderApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtDate, fmtDateTime, fmtMoney } from '@/utils/format';

const NODE_OPTIONS = [
  { label: '已揽收', value: '已揽收' },
  { label: '运输中', value: '运输中' },
  { label: '到达中转场', value: '到达中转场' },
  { label: '派送中', value: '派送中' },
  { label: '已签收', value: '已签收' },
  { label: '异常', value: '异常' },
];

export default function LogisticsDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const { data: lo, loading, reload } = useRequest(() => logisticsApi.get(id), [id]);
  const { data: po } = useRequest(
    async () => (lo ? purchaseOrderApi.get(lo.poId) : undefined),
    [lo?.poId],
  );

  const [simOpen, setSimOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const submitSim = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await logisticsApi.simulateUpdate(id, values);
      message.success('物流节点已更新');
      setSimOpen(false);
      form.resetFields();
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<PurchaseOrderItem> = [
    { title: '商品', dataIndex: 'productName' },
    { title: '规格', dataIndex: 'spec' },
    { title: '数量', dataIndex: 'qty', width: 80, align: 'right' },
    { title: '单价', dataIndex: 'price', width: 100, align: 'right', render: (v) => fmtMoney(v) },
  ];

  if (!lo) {
    return (
      <>
        <PageHeader title="物流详情" backTo="/purchase/logistics" backText="返回物流列表" />
        <Card loading={loading} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <Space size={10}>
            <span className="sm-mono" style={{ fontSize: 20 }}>
              {lo.code}
            </span>
            <LogisticsStatusTag status={lo.status} />
            {lo.delayed && <Tag color="red">延迟</Tag>}
          </Space>
        }
        description={`${lo.carrier} · 运单号 ${lo.trackingNo} · 供应商 ${lo.supplierName}`}
        backTo="/purchase/logistics"
        backText="返回物流列表"
        // extra={
        //   <Button icon={<NodeIndexOutlined />} onClick={() => setSimOpen(true)}>
        //     模拟更新节点
        //   </Button>
        // }
      />

      {lo.delayed && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`该物流单已超过预计到达时间（${fmtDate(lo.expectedArrival)}）仍未送达`}
          description="按《物流异常处理规范》，超期 3 天须生成异常分析报告并明确责任方。"
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="物流轨迹" size="small">
            <Timeline
              items={[...lo.events]
                .slice()
                .reverse()
                .map((e, idx) => ({
                  color:
                    idx === 0
                      ? e.node.includes('异常')
                        ? 'red'
                        : e.node.includes('签收')
                          ? 'green'
                          : 'blue'
                      : 'gray',
                  children: (
                    <div>
                      <Space size={8} wrap>
                        <b style={{ fontSize: 13.5 }}>{e.node}</b>
                        <span className="sm-muted" style={{ fontSize: 12 }}>
                          {fmtDateTime(e.time)} · {e.location}
                        </span>
                      </Space>
                      <div style={{ fontSize: 13, color: '#4a5160', marginTop: 2 }}>{e.desc}</div>
                    </div>
                  ),
                }))}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card title="物流信息" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small" colon={false} styles={{ label: { color: '#8a919f', width: 84 } }}>
              <Descriptions.Item label="承运商">{lo.carrier}</Descriptions.Item>
              <Descriptions.Item label="运单号">
                <span className="sm-mono">{lo.trackingNo}</span>
              </Descriptions.Item>
              <Descriptions.Item label="预计到达">{fmtDate(lo.expectedArrival)}</Descriptions.Item>
              <Descriptions.Item label="关联采购单">
                <a className="sm-mono" onClick={() => navigate(`/purchase/orders/${lo.poId}`)}>
                  {lo.poCode}
                </a>
              </Descriptions.Item>
              <Descriptions.Item label="异常说明">{lo.remark ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            title="关联采购商品"
            size="small"
            extra={
              <Typography.Link onClick={() => navigate(`/purchase/orders/${lo.poId}`)}>查看订单</Typography.Link>
            }
          >
            <Table<PurchaseOrderItem>
              rowKey="id"
              size="small"
              loading={!po}
              columns={columns}
              dataSource={po?.items ?? []}
              pagination={false}
              locale={{ emptyText: '未关联到采购订单明细' }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="模拟更新物流节点"
        open={simOpen}
        okText="写入节点"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setSimOpen(false)}
        onOk={() => void submitSim()}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="这是演示用的模拟入口"
          description="真实系统由承运商接口回调写入；接入后端后该入口会移除。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="node" label="节点" rules={[{ required: true, message: '请选择节点' }]}>
            <Select options={NODE_OPTIONS} placeholder="选择节点" />
          </Form.Item>
          <Form.Item name="desc" label="说明" rules={[{ required: true, message: '请填写说明' }]}>
            <Input placeholder="例如：快件到达上海青浦中转场" />
          </Form.Item>
          <Form.Item name="location" label="地点" rules={[{ required: true, message: '请填写地点' }]}>
            <Input placeholder="例如：上海" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
