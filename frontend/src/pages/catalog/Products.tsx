import React, { useState } from 'react';
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import type { Product, ProductStatus } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { CATALOG_TABS } from './tabs';
import { productApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtMoney } from '@/utils/format';

export default function Products() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();

  const [keyword, setKeyword] = useState(params.get('keyword') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [query, setQuery] = useState({
    keyword: params.get('keyword') ?? '',
    category: params.get('category') ?? '',
    page: 1,
    pageSize: 10,
  });

  const { data, loading, reload } = useRequest(
    () => productApi.list(query),
    [query.keyword, query.category, query.page, query.pageSize],
  );
  const { data: categories } = useRequest(() => productApi.categories(), []);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Product>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' } as Partial<Product>);
    setOpen(true);
  };

  const openEdit = (row: Product) => {
    setEditing(row);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await productApi.update(editing.id, values);
        message.success('商品已更新');
      } else {
        await productApi.create(values as Omit<Product, 'id' | 'code' | 'createdAt'>);
        message.success('商品已创建');
      }
      setOpen(false);
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: Product) => {
    try {
      await productApi.setStatus(row.id, row.status === 'active' ? 'disabled' : 'active');
      message.success(row.status === 'active' ? '已停用' : '已启用');
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const columns: ColumnsType<Product> = [
    { title: '商品编号', dataIndex: 'code', width: 100, render: (v) => <span className="sm-mono">{v}</span> },
    { title: '商品名称', dataIndex: 'name' },
    { title: '商品大类', dataIndex: 'category', width: 110, render: (v) => <Tag>{v}</Tag> },
    {
      title: '商品小类',
      dataIndex: 'subCategory',
      width: 110,
      render: (v) => (v ? <Tag color="blue">{v}</Tag> : <span className="sm-muted">未分类</span>),
    },
    { title: '规格', dataIndex: 'spec', width: 160, render: (v) => <span className="sm-muted">{v}</span> },
    { title: '单位', dataIndex: 'unit', width: 72 },
    { title: '安全库存', dataIndex: 'safetyStock', width: 100, align: 'right' },
    { title: '默认采购价', dataIndex: 'purchasePrice', width: 120, align: 'right', render: (v) => fmtMoney(v) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: ProductStatus) => (v === 'active' ? <Tag color="green">在售</Tag> : <Tag>已停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title={row.status === 'active' ? '确认停用该商品？' : '确认启用该商品？'}
            okText="确认"
            cancelText="取消"
            onConfirm={() => void toggle(row)}
          >
            <Button type="link" size="small" danger={row.status === 'active'}>
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="商品管理"
        description="维护商品基础资料；安全库存是库存预警与补货建议的计算基准"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建商品
          </Button>
        }
      />

            <ModuleTabs items={CATALOG_TABS} />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            style={{ width: 240 }}
            placeholder="搜索商品名称 / 编号 / 规格"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => setQuery((q) => ({ ...q, keyword, page: 1 }))}
          />
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder="商品大类"
            value={category || undefined}
            onChange={(v) => setCategory(v ?? '')}
            options={(categories ?? []).map((c) => ({ label: c, value: c }))}
          />
          <Button type="primary" onClick={() => setQuery((q) => ({ ...q, keyword, category, page: 1 }))}>
            查询
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setKeyword('');
              setCategory('');
              setQuery({ keyword: '', category: '', page: 1, pageSize: 10 });
              setParams(new URLSearchParams());
            }}
          >
            重置
          </Button>
        </div>

        <Table<Product>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.list ?? []}
          scroll={{ x: 1100 }}
          locale={{ emptyText: '还没有商品' }}
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
        title={editing ? '编辑商品' : '新建商品'}
        width={480}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
            <Input placeholder="例如：五层瓦楞纸箱" />
          </Form.Item>
          <Form.Item name="category" label="商品大类" rules={[{ required: true, message: '请选择商品大类' }]}>
            <Select
              options={(categories ?? []).map((c) => ({ label: c, value: c }))}
              placeholder="选择商品大类"
              showSearch
            />
          </Form.Item>
          <Form.Item
            name="subCategory"
            label="商品小类"
            rules={[{ required: true, message: '请输入商品小类' }]}
            extra="采购下单时按「大类 → 小类」筛选商品"
          >
            <Input placeholder="例如：纸品清洁 / 粮油速食" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="spec" label="规格" rules={[{ required: true, message: '请输入规格' }]} style={{ flex: 1 }}>
              <Input placeholder="600×400×300mm" />
            </Form.Item>
            <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]} style={{ width: 110 }}>
              <Input placeholder="个" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="safetyStock"
              label="安全库存"
              rules={[{ required: true, message: '请输入安全库存' }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="purchasePrice"
              label="默认采购价"
              rules={[{ required: true, message: '请输入采购价' }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={0} step={0.1} style={{ width: '100%' }} addonBefore="¥" />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: '在售', value: 'active' },
                { label: '已停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
