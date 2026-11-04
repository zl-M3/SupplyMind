import React, { useMemo, useState } from 'react';
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Product, PurchaseOrder } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { PURCHASE_TABS } from './tabs';
import { PoStatusTag } from '@/components/StatusTag';
import { productApi, purchaseOrderApi, supplierApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtAmount, fmtDate, fmtMoney } from '@/utils/format';
import { downloadExport } from '@/utils/download';

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();

  const [keyword, setKeyword] = useState(params.get('keyword') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [supplierId, setSupplierId] = useState(params.get('supplierId') ?? '');
  const [query, setQuery] = useState({
    keyword: params.get('keyword') ?? '',
    status: params.get('status') ?? '',
    supplierId: params.get('supplierId') ?? '',
    page: 1,
    pageSize: 10,
  });

  const { data, loading, reload } = useRequest(
    () => purchaseOrderApi.list(query),
    [query.keyword, query.status, query.supplierId, query.page, query.pageSize],
  );
  const { data: supplierOptionList } = useRequest(
    () =>
      supplierApi.options().catch(() =>
        supplierApi.list({ pageSize: 100 }).then((page) =>
          page.list
            .filter((s) => s.status === 'active')
            .map((s) => ({ label: `${s.name}（${s.code}）`, value: s.id, categories: s.categories })),
        ),
      ),
    [],
  );
  const { data: productPage } = useRequest(() => productApi.list({ pageSize: 200 }), []);

  const supplierOptions = useMemo(
    () =>
      (supplierOptionList ?? []).map((s) => ({
        label: s.label,
        value: s.value,
        categories: s.categories ?? [],
      })),
    [supplierOptionList],
  );
  const productList: Product[] = productPage?.list ?? [];

  /* ---------------- 新建 ---------------- */
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [major, setMajor] = useState<string | undefined>();
  const [pickedSupplierId, setPickedSupplierId] = useState<string | undefined>();
  const [form] = Form.useForm();

  /** 商品大类：直接取商品主数据里的大类 */
  const majorOptions = useMemo(
    () =>
      Array.from(new Set(productList.map((p) => p.category).filter(Boolean))).map((c) => ({
        label: c,
        value: c,
      })),
    [productList],
  );

  /** 只有「可供应所选大类」的合作公司才出现在下拉里 */
  const supplierOptionsOfMajor = useMemo(() => {
    if (!major) return [];
    return supplierOptions.filter((s) => (s.categories ?? []).includes(major));
  }, [supplierOptions, major]);

  /** 商品范围收敛到所选大类 */
  const productOptions = useMemo(() => {
    if (!major) return [];
    return productList
      .filter((p) => p.category === major)
      .map((p) => ({ label: `${p.name}（${p.spec}）`, value: p.id }));
  }, [productList, major]);

  const onMajorChange = (value: string) => {
    setMajor(value);
    setPickedSupplierId(undefined);
    form.resetFields(['supplierId']);
    form.setFieldsValue({ items: [{ qty: 1 }] });
  };

  const openCreate = () => {
    form.resetFields();
    setMajor(undefined);
    setPickedSupplierId(undefined);
    form.setFieldsValue({ items: [{ qty: 1 }] });
    setOpen(true);
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const po = await purchaseOrderApi.create({
        supplierId: values.supplierId,
        expectedArrival: dayjs(values.expectedArrival).format('YYYY-MM-DD'),
        remark: values.remark,
        items: values.items,
      });
      message.success(`已保存草稿：${po.code}`);
      setOpen(false);
      reload();
      navigate(`/purchase/orders/${po.id}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const doSearch = () => {
    setQuery({ keyword, status, supplierId, page: 1, pageSize: query.pageSize });
    setParams((p) => {
      const next = new URLSearchParams(p);
      status ? next.set('status', status) : next.delete('status');
      supplierId ? next.set('supplierId', supplierId) : next.delete('supplierId');
      return next;
    });
  };

  /** 条件没变时（只是想刷新一下）直接重新拉取，避免页面一直用旧数据 */
  const searchAndReload = () => {
    const same =
      query.keyword === keyword &&
      query.status === status &&
      query.supplierId === supplierId &&
      query.page === 1;
    doSearch();
    if (same) void reload();
  };

  const reset = () => {
    setKeyword('');
    setStatus('');
    setSupplierId('');
    setQuery({ keyword: '', status: '', supplierId: '', page: 1, pageSize: 10 });
    setParams(new URLSearchParams());
  };

  const columns: ColumnsType<PurchaseOrder> = [
    {
      title: '订单编号',
      dataIndex: 'code',
      width: 172,
      render: (v, row) => (
        <a className="sm-mono" onClick={() => navigate(`/purchase/orders/${row.id}`)}>
          {v}
        </a>
      ),
    },
    { title: '供应商', dataIndex: 'supplierName', ellipsis: true },
    {
      title: '商品明细',
      dataIndex: 'items',
      width: 220,
      render: (items: PurchaseOrder['items']) => (
        <span style={{ fontSize: 12.5 }}>
          {items[0]?.productName}
          {items.length > 1 && <Tag style={{ marginLeft: 6 }}>+{items.length - 1}</Tag>}
        </span>
      ),
    },
    { title: '金额', dataIndex: 'totalAmount', width: 110, align: 'right', render: (v) => fmtAmount(v) },
    { title: '创建人', dataIndex: 'createdByName', width: 90 },
    { title: '预计到货', dataIndex: 'expectedArrival', width: 110, render: (v) => fmtDate(v) },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <PoStatusTag status={v} /> },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => navigate(`/purchase/orders/${row.id}`)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="采购订单"
        description="从创建草稿到审批、收货的完整流程；采购员提交需管理者审批，管理者提交直接通过"
      />

      <ModuleTabs items={PURCHASE_TABS} />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            style={{ width: 220 }}
            placeholder="搜索订单号 / 供应商 / 商品"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={doSearch}
          />
          <Select
            allowClear
            style={{ width: 130 }}
            placeholder="订单状态"
            value={status || undefined}
            onChange={(v) => setStatus(v ?? '')}
            options={[
              { label: '草稿', value: 'draft' },
              { label: '待审批', value: 'pending' },
              { label: '已审批', value: 'approved' },
              { label: '部分收货', value: 'partial' },
              { label: '已完成', value: 'completed' },
              { label: '已驳回', value: 'rejected' },
              { label: '已取消', value: 'cancelled' },
            ]}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 240 }}
            placeholder="供应商"
            value={supplierId || undefined}
            onChange={(v) => setSupplierId(v ?? '')}
            options={supplierOptions}
          />
          <Button type="primary" onClick={searchAndReload}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={reset}>
            重置
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              downloadExport('/export/purchase-orders.xlsx', '采购订单.xlsx', {
                keyword: query.keyword,
                status: query.status,
              }).catch((e) => message.error(e instanceof Error ? e.message : '导出失败'));
            }}
          >
            导出 Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建采购订单
          </Button>
        </div>

        <Table<PurchaseOrder>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.list ?? []}
          scroll={{ x: 1150 }}
          locale={{ emptyText: '没有符合条件的采购订单' }}
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

      <Drawer
        title="新建采购订单"
        width={720}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submitCreate()}>
              保存草稿
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="majorCategory"
              label="商品大类"
              rules={[{ required: true, message: '请选择商品大类' }]}
              style={{ flex: 1 }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={majorOptions}
                placeholder="选择商品大类"
                onChange={onMajorChange}
              />
            </Form.Item>
            <Form.Item
              name="expectedArrival"
              label="预计到货日期"
              rules={[{ required: true, message: '请选择日期' }]}
              style={{ width: 180 }}
            >
              <DatePicker style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
            </Form.Item>
          </Space>

          <Form.Item
            name="supplierId"
            label="供应商（仅显示可供应所选大类的公司）"
            rules={[{ required: true, message: '请选择供应商' }]}
            style={{ marginBottom: 8 }}
          >
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!major}
              options={supplierOptionsOfMajor}
              placeholder={
                !major
                  ? '请先选择商品大类'
                  : supplierOptionsOfMajor.length
                    ? '选择可供应此大类的公司'
                    : '该大类暂无合作供应商'
              }
              notFoundContent="该大类下暂无合作供应商"
              onChange={(value) => setPickedSupplierId(value)}
            />
          </Form.Item>
          {major && supplierOptionsOfMajor.length === 0 && (
            <div style={{ color: '#d4380d', fontSize: 12.5, marginTop: -4, marginBottom: 8 }}>
              「{major}」暂无可供应的合作公司，请先在「供应商管理」里维护其主营大类。
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>商品明细</span>
            <span style={{ flex: 1, height: 1, background: 'var(--sm-border)' }} />
          </div>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}
                  >
                    <Form.Item
                      name={[field.name, 'productId']}
                      rules={[{ required: true, message: '请选择商品' }]}
                      style={{ marginBottom: 0, flex: 1, minWidth: 0 }}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        disabled={!pickedSupplierId}
                        options={productOptions}
                        placeholder={
                          !major
                            ? '请先选择商品大类'
                            : !pickedSupplierId
                              ? '请先选择供应商'
                              : '选择商品'
                        }
                        onChange={(pid) => {
                          const p = productList.find((x) => x.id === pid);
                          const items = form.getFieldValue('items') ?? [];
                          items[field.name] = { ...(items[field.name] ?? {}), price: p?.purchasePrice };
                          form.setFieldsValue({ items });
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'qty']}
                      rules={[{ required: true, message: '数量' }]}
                      style={{ marginBottom: 0, width: 110 }}
                    >
                      <InputNumber min={1} placeholder="数量" style={{ width: '100%' }} addonAfter="件" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'price']}
                      rules={[{ required: true, message: '单价' }]}
                      style={{ marginBottom: 0, width: 140 }}
                    >
                      <InputNumber
                        min={0.01}
                        step={0.5}
                        placeholder="单价"
                        style={{ width: '100%' }}
                        addonBefore="¥"
                      />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                      disabled={fields.length === 1}
                      style={{ flex: '0 0 auto' }}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ qty: 1 })}
                  block
                  disabled={!pickedSupplierId}
                >
                  添加商品
                </Button>
              </>
            )}
          </Form.List>

          <Form.Item noStyle shouldUpdate>
            {() => {
              const items = form.getFieldValue('items') ?? [];
              const total = items.reduce(
                (s: number, i: any) => s + (Number(i?.qty) || 0) * (Number(i?.price) || 0),
                0,
              );
              return (
                <div style={{ textAlign: 'right', marginTop: 12, fontSize: 14 }}>
                  合计金额：<b>{fmtMoney(total)}</b>
                </div>
              );
            }}
          </Form.Item>

          <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} placeholder="采购原因、特殊要求等" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
