import React, { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { PurchaseOrder, PurchaseOrderItem } from '@/types';
import PageHeader from '@/components/PageHeader';
import { LogisticsStatusTag, PoStatusTag } from '@/components/StatusTag';
import { logisticsApi, purchaseOrderApi, warehouseApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { useCurrentUser, isAdminUser } from '@/hooks/useCurrentUser';
import { fmtAmount, fmtDate, fmtDateTime, fmtMoney } from '@/utils/format';

const STEP_INDEX: Record<PurchaseOrder['status'], number> = {
  draft: 0,
  pending: 1,
  approved: 2,
  partial: 3,
  completed: 4,
  rejected: 1,
  cancelled: 0,
};

export default function PurchaseOrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const { data: po, loading, reload } = useRequest(() => purchaseOrderApi.get(id), [id]);
  const { data: warehouses } = useRequest(() => warehouseApi.list(), []);
  const { data: logisticsPage } = useRequest(() => logisticsApi.list({ pageSize: 100 }), []);
  const { data: receipts, reload: reloadReceipts } = useRequest(
    () => purchaseOrderApi.receipts(id).catch(() => []),
    [id],
  );
  const me = useCurrentUser();
  const admin = isAdminUser(me);
  const logistics = useMemo(
    () => logisticsPage?.list.find((l) => l.poId === id),
    [logisticsPage, id],
  );

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveWarehouse, setReceiveWarehouse] = useState<string>();
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const doAction = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      message.success(okText);
      reload();
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openReceive = () => {
    if (!po) return;
    setReceiveWarehouse(warehouses?.[0]?.id);
    setReceiveQty(
      Object.fromEntries(po.items.map((i) => [i.id, Math.max(0, i.qty - i.receivedQty)])),
    );
    setReceiveOpen(true);
  };

  const submitReceive = async () => {
    if (!receiveWarehouse) {
      message.error('请选择入库仓库');
      return;
    }
    const items = Object.entries(receiveQty)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, qty }));
    if (!items.length) {
      message.error('请至少填写一项收货数量');
      return;
    }
    const ok = await doAction(
      () => purchaseOrderApi.receive(id, { warehouseId: receiveWarehouse, items }),
      '收货成功，库存已更新',
    );
    if (ok) {
      setReceiveOpen(false);
      reloadReceipts();
    }
  };

  const columns: ColumnsType<PurchaseOrderItem> = [
    { title: '商品', dataIndex: 'productName' },
    { title: '规格', dataIndex: 'spec', width: 150, render: (v) => <span className="sm-muted">{v}</span> },
    { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
    { title: '单价', dataIndex: 'price', width: 100, align: 'right', render: (v) => fmtMoney(v) },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (v) => fmtMoney(v) },
    { title: '已收货', dataIndex: 'receivedQty', width: 90, align: 'right' },
    {
      title: '未收货',
      width: 100,
      align: 'right',
      render: (_, row) => {
        const remain = row.qty - row.receivedQty;
        return remain > 0 ? <Tag color="orange">{remain}</Tag> : <Tag color="green">0</Tag>;
      },
    },
  ];

  if (!po) {
    return (
      <>
        <PageHeader title="采购订单详情" backTo="/purchase/orders" backText="返回采购订单" />
        <Card loading={loading} />
      </>
    );
  }

  const stepsCurrent = STEP_INDEX[po.status];
  const stepStatus = po.status === 'rejected' || po.status === 'cancelled' ? 'error' : undefined;

  return (
    <>
      <PageHeader
        title={
          <Space size={10}>
            <span className="sm-mono" style={{ fontSize: 20 }}>
              {po.code}
            </span>
            <PoStatusTag status={po.status} />
          </Space>
        }
        description={`${po.supplierName} · 创建人 ${po.createdByName} · ${fmtDateTime(po.createdAt)}`}
        backTo="/purchase/orders"
        backText="返回采购订单"
        extra={
          <>
            {po.status === 'draft' && (
              <Button
                type="primary"
                loading={busy}
                onClick={() =>
                  void doAction(
                    () => purchaseOrderApi.submit(po.id),
                    admin ? '提交完成：管理者免审批，已直接通过' : '已提交审批，等待管理者审批',
                  )
                }
              >
                {admin ? '提交并直接通过' : '提交审批'}
              </Button>
            )}

            {po.status === 'pending' && admin && (
              <>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => void doAction(() => purchaseOrderApi.approve(po.id), '审批已通过')}
                >
                  审批通过
                </Button>
                <Button danger onClick={() => setRejectOpen(true)}>
                  驳回
                </Button>
              </>
            )}

            {po.status === 'pending' && !admin && (
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                等待管理者审批
              </Tag>
            )}

            {(po.status === 'approved' || po.status === 'partial') && (
              <Button type="primary" onClick={openReceive}>
                登记收货
              </Button>
            )}
          </>
        }
      />

      {po.status === 'rejected' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`已驳回：${po.rejectReason ?? '-'}`}
          description={`审批人 ${po.approverName ?? '-'}`}
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          status={stepStatus}
          current={stepsCurrent}
          items={[
            { title: '草稿' },
            { title: '待审批' },
            { title: '已审批' },
            { title: '部分收货' },
            { title: '已完成' },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" colon={false} styles={{ label: { color: '#8a919f', width: 84 } }}>
              <Descriptions.Item label="供应商">{po.supplierName}</Descriptions.Item>
              <Descriptions.Item label="订单金额">{fmtMoney(po.totalAmount)}</Descriptions.Item>
              <Descriptions.Item label="预计到货">{fmtDate(po.expectedArrival)}</Descriptions.Item>
              <Descriptions.Item label="创建人">{po.createdByName}</Descriptions.Item>
              <Descriptions.Item label="审批人">{po.approverName ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="审批时间">{fmtDateTime(po.approvedAt)}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {po.remark ?? '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title={`商品明细（${po.items.length}）`} size="small">
            <Table<PurchaseOrderItem>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={po.items}
              pagination={false}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <b>合计</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <b>{fmtAmount(po.totalAmount)}</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    {po.items.reduce((s, i) => s + i.receivedQty, 0)}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    {po.items.reduce((s, i) => s + i.qty - i.receivedQty, 0)}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </Card>

          {!!receipts?.length && (
            <Card title={`收货记录（${receipts.length}）`} size="small" style={{ marginTop: 16 }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {receipts.map((r) => (
                  <div key={r.id}>
                    <Space size={8} wrap>
                      <span className="sm-mono" style={{ fontSize: 12.5 }}>
                        {r.code}
                      </span>
                      <Tag color="green">已入库</Tag>
                      <span className="sm-muted" style={{ fontSize: 12.5 }}>
                        {r.warehouseName} · {r.receivedBy} · {fmtDateTime(r.receivedAt)}
                      </span>
                    </Space>
                    <div className="sm-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {r.items
                        .map((line) => `${line.productName || line.poItemId} × ${line.qty}`)
                        .join('，')}
                    </div>
                  </div>
                ))}
              </Space>
            </Card>
          )}
        </Col>

        <Col xs={24} xl={8}>
          <Card title="物流信息" size="small">
            {logistics ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <a className="sm-mono" onClick={() => navigate(`/purchase/logistics/${logistics.id}`)}>
                    {logistics.code}
                  </a>
                </div>
                <Space size={8} wrap>
                  <LogisticsStatusTag status={logistics.status} />
                  {logistics.delayed && <Tag color="red">延迟</Tag>}
                </Space>
                <div className="sm-muted" style={{ fontSize: 12.5 }}>
                  承运商 {logistics.carrier} · 运单号 {logistics.trackingNo}
                </div>
                <div className="sm-muted" style={{ fontSize: 12.5 }}>
                  预计到达 {fmtDate(logistics.expectedArrival)}
                </div>
                <div>
                  <Typography.Text style={{ fontSize: 13 }}>
                    最新节点：{logistics.events[logistics.events.length - 1]?.node}
                  </Typography.Text>
                </div>
                <Button size="small" onClick={() => navigate(`/purchase/logistics/${logistics.id}`)}>
                  查看轨迹
                </Button>
              </Space>
            ) : (
              <div className="sm-muted" style={{ fontSize: 13 }}>
                尚未创建物流单。审批通过后系统会自动生成模拟物流单。
              </div>
            )}
          </Card>

          <Card title="业务规则" size="small" style={{ marginTop: 16 }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#5a6272', lineHeight: 1.9 }}>
              <li>采购员提交 → 进入待审批，由管理者审批</li>
              <li>管理者提交 → 免审批，提交即通过</li>
              <li>审批人不能审批「他人提交、自己创建」的单据</li>
              <li>收货数量不能超过剩余未收数量</li>
              <li>库存更新与库存流水在同一事务内完成</li>
              <li>AI 只能生成草稿，审批与收货必须人工操作</li>
            </ul>
          </Card>
        </Col>
      </Row>

      {/* 驳回 */}
      <Modal
        title="驳回采购订单"
        open={rejectOpen}
        okText="确认驳回"
        okButtonProps={{ danger: true, loading: busy }}
        cancelText="取消"
        onCancel={() => setRejectOpen(false)}
        onOk={async () => {
          if (!rejectReason.trim()) {
            message.error('请填写驳回原因');
            return;
          }
          const ok = await doAction(() => purchaseOrderApi.reject(id, rejectReason), '已驳回');
          if (ok) {
            setRejectOpen(false);
            setRejectReason('');
          }
        }}
      >
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="例如：供应商资质过期，请补充材料后重新提交"
        />
      </Modal>

      {/* 收货 */}
      <Modal
        title="登记收货"
        open={receiveOpen}
        width={640}
        okText="确认收货"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setReceiveOpen(false)}
        onOk={() => void submitReceive()}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <div className="sm-muted" style={{ marginBottom: 6 }}>
              入库仓库
            </div>
            <Select
              style={{ width: '100%' }}
              value={receiveWarehouse}
              onChange={setReceiveWarehouse}
              options={(warehouses ?? [])
                .filter((w) => w.status === 'active')
                .map((w) => ({ label: `${w.name}（${w.code}）`, value: w.id }))}
            />
          </div>

          <Divider style={{ margin: 0 }}>本次收货数量（不能超过未收数量）</Divider>

          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {po.items.map((item) => {
              const remain = item.qty - item.receivedQty;
              return (
                <div
                  key={item.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                >
                  <div>
                    <div style={{ fontSize: 13.5 }}>{item.productName}</div>
                    <div className="sm-muted" style={{ fontSize: 12 }}>
                      订购 {item.qty} · 已收 {item.receivedQty} · 未收 {remain} {item.unit}
                    </div>
                  </div>
                  <InputNumber
                    min={0}
                    max={remain}
                    disabled={remain === 0}
                    value={receiveQty[item.id] ?? 0}
                    onChange={(v) => setReceiveQty((prev) => ({ ...prev, [item.id]: Number(v ?? 0) }))}
                    addonAfter={item.unit}
                    style={{ width: 150 }}
                  />
                </div>
              );
            })}
          </Space>

          <Alert
            type="info"
            showIcon
            message="收货后会自动更新库存汇总，并写入库存流水"
            description="库存更新与流水写入在同一事务内完成；如数量超过未收数量，本次提交会被拒绝。"
          />
        </Space>
      </Modal>
    </>
  );
}
