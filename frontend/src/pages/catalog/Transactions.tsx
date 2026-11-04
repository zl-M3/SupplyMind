import React, { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import type { InventoryTransaction, StockTransfer, TransactionType } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { CATALOG_TABS } from './tabs';
import { productApi, stockApi, transactionApi, transferApi, warehouseApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtDateTime } from '@/utils/format';

const TYPE_LABEL: Record<TransactionType, { text: string; color: string }> = {
  purchase_in: { text: '采购入库', color: 'green' },
  transfer_in: { text: '调拨入库', color: 'blue' },
  transfer_out: { text: '调拨出库', color: 'orange' },
};

export default function Transactions() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<'tx' | 'transfer'>('tx');

  /* ---------------- 库存流水 ---------------- */
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [query, setQuery] = useState({ keyword: '', type: '', page: 1, pageSize: 10 });

  const { data: txPage, loading } = useRequest(
    () => transactionApi.list(query),
    [query.keyword, query.type, query.page, query.pageSize],
  );

  const txColumns: ColumnsType<InventoryTransaction> = [
    { title: '时间', dataIndex: 'createdAt', width: 152, render: (v) => fmtDateTime(v) },
    {
      title: '类型',
      dataIndex: 'type',
      width: 106,
      render: (v: TransactionType) => <Tag color={TYPE_LABEL[v].color}>{TYPE_LABEL[v].text}</Tag>,
    },
    { title: '商品', dataIndex: 'productName' },
    { title: '仓库', dataIndex: 'warehouseName', width: 110 },
    {
      title: '变动数量',
      dataIndex: 'qty',
      width: 100,
      align: 'right',
      render: (v: number) => (
        <b style={{ color: v >= 0 ? '#389e0d' : '#d4380d' }}>{v > 0 ? `+${v}` : v}</b>
      ),
    },
    {
      title: '变动后结存',
      dataIndex: 'afterQty',
      width: 110,
      align: 'right',
      render: (v, row) => (
        <span>
          {v}
          <span className="sm-muted" style={{ fontSize: 12 }}> （前 {row.beforeQty}）</span>
        </span>
      ),
    },
    { title: '单据号', dataIndex: 'refCode', width: 172, render: (v) => <span className="sm-mono">{v}</span> },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    { title: '备注', dataIndex: 'remark', width: 140, render: (v) => <span className="sm-muted">{v ?? '-'}</span> },
  ];

  /* ---------------- 调拨 ---------------- */
  const { data: transfers, loading: transferLoading, reload: reloadTransfers } = useRequest(
    () => transferApi.list(),
    [],
  );
  const { data: warehouses } = useRequest(() => warehouseApi.list(), []);
  const { data: productPage } = useRequest(() => productApi.list({ pageSize: 200 }), []);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [checkSku, setCheckSku] = useState<{ fromWarehouseId: string; productId: string }>();

  const { data: stockRows } = useRequest(
    () => (checkSku?.fromWarehouseId && checkSku?.productId ? stockApi.overview() : Promise.resolve([])),
    [checkSku?.fromWarehouseId, checkSku?.productId],
  );

  const availableQty = useMemo(() => {
    if (!checkSku?.fromWarehouseId || !checkSku?.productId) return undefined;
    const row = (stockRows ?? []).find((r) => r.productId === checkSku.productId);
    return row?.warehouses.find((w) => w.warehouseId === checkSku.fromWarehouseId)?.qty;
  }, [stockRows, checkSku]);

  const transferColumns: ColumnsType<StockTransfer> = [
    { title: '调拨单号', dataIndex: 'code', width: 172, render: (v) => <span className="sm-mono">{v}</span> },
    { title: '商品', dataIndex: 'productName' },
    {
      title: '调出 → 调入',
      key: 'route',
      width: 220,
      render: (_, row) => (
        <Space size={6}>
          <Tag>{row.fromWarehouseName}</Tag>
          <SwapOutlined className="sm-muted" />
          <Tag color="blue">{row.toWarehouseName}</Tag>
        </Space>
      ),
    },
    { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    { title: '时间', dataIndex: 'createdAt', width: 152, render: (v) => fmtDateTime(v) },
    { title: '备注', dataIndex: 'remark', render: (v) => <span className="sm-muted">{v ?? '-'}</span> },
  ];

  const submitTransfer = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const tr = await transferApi.create(values);
      message.success(`调拨成功：${tr.code}，已同步写入 2 条库存流水`);
      setOpen(false);
      form.resetFields();
      setCheckSku(undefined);
      reloadTransfers();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '调拨失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="库存流水与调拨"
        description="采购入库与仓库调拨都会写入库存流水；调拨会一次性扣减调出仓并增加调入仓"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setCheckSku(undefined);
              setOpen(true);
            }}
          >
            新建调拨
          </Button>
        }
      />

            <ModuleTabs items={CATALOG_TABS} />

      <div className="sm-table-wrap">
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as typeof tab)}
          style={{ padding: '8px 16px 0' }}
          items={[
            {
              key: 'tx',
              label: '库存流水',
              children: (
                <>
                  <div className="sm-toolbar">
                    <Input
                      allowClear
                      style={{ width: 240 }}
                      placeholder="搜索商品 / 单据号 / 操作人"
                      prefix={<SearchOutlined />}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      onPressEnter={() => setQuery((q) => ({ ...q, keyword, page: 1 }))}
                    />
                    <Select
                      allowClear
                      style={{ width: 140 }}
                      placeholder="流水类型"
                      value={type || undefined}
                      onChange={(v) => setType(v ?? '')}
                      options={[
                        { label: '采购入库', value: 'purchase_in' },
                        { label: '调拨入库', value: 'transfer_in' },
                        { label: '调拨出库', value: 'transfer_out' },
                      ]}
                    />
                    <Button type="primary" onClick={() => setQuery((q) => ({ ...q, keyword, type, page: 1 }))}>
                      查询
                    </Button>
                  </div>
                  <Table<InventoryTransaction>
                    rowKey="id"
                    loading={loading}
                    columns={txColumns}
                    dataSource={txPage?.list ?? []}
                    scroll={{ x: 1180 }}
                    locale={{ emptyText: '暂无库存流水，收货或调拨后会生成' }}
                    pagination={{
                      current: query.page,
                      pageSize: query.pageSize,
                      total: txPage?.total ?? 0,
                      showSizeChanger: true,
                      showTotal: (t) => `共 ${t} 条`,
                      onChange: (page, pageSize) => setQuery((q) => ({ ...q, page, pageSize })),
                    }}
                  />
                </>
              ),
            },
            {
              key: 'transfer',
              label: '库存调拨',
              children: (
                <>
                  <div className="sm-toolbar">
                    <Alert
                      type="info"
                      showIcon
                      style={{ flex: 1 }}
                      message="调拨会校验调出仓库可用库存，不足以扣减时会被拒绝；确认后一次性完成扣减与增加，并生成可追踪的调拨记录。"
                    />
                  </div>
                  <Table<StockTransfer>
                    rowKey="id"
                    loading={transferLoading}
                    columns={transferColumns}
                    dataSource={transfers ?? []}
                    scroll={{ x: 1080 }}
                    locale={{ emptyText: '暂无调拨记录' }}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  />
                </>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title="新建库存调拨"
        open={open}
        width={560}
        okText="确认调拨"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={() => void submitTransfer()}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('fromWarehouseId' in changed || 'productId' in changed) {
              const v = form.getFieldsValue(['fromWarehouseId', 'productId']);
              setCheckSku(v);
            }
          }}
        >
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="fromWarehouseId"
              label="调出仓库"
              rules={[{ required: true, message: '请选择调出仓库' }]}
              style={{ flex: 1 }}
            >
              <Select
                options={(warehouses ?? []).map((w) => ({ label: w.name, value: w.id }))}
                placeholder="选择调出仓库"
              />
            </Form.Item>
            <Form.Item
              name="toWarehouseId"
              label="调入仓库"
              rules={[{ required: true, message: '请选择调入仓库' }]}
              style={{ flex: 1 }}
            >
              <Select
                options={(warehouses ?? []).map((w) => ({ label: w.name, value: w.id }))}
                placeholder="选择调入仓库"
              />
            </Form.Item>
          </Space>
          <Form.Item name="productId" label="商品" rules={[{ required: true, message: '请选择商品' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择商品"
              options={(productPage?.list ?? []).map((p) => ({
                label: `${p.name}（${p.spec}）`,
                value: p.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="qty"
            label={availableQty != null ? `调拨数量（调出仓可用 ${availableQty}）` : '调拨数量'}
            rules={[
              { required: true, message: '请输入调拨数量' },
              {
                validator: (_, value) => {
                  if (availableQty != null && value > availableQty) {
                    return Promise.reject(new Error(`超过调出仓库可用库存 ${availableQty}`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="例如：华东缺口补齐" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
