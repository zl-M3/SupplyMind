import React, { useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Warehouse } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { CATALOG_TABS } from './tabs';
import { warehouseApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fmtDate } from '@/utils/format';

export default function Warehouses() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { data, loading, reload } = useRequest(() => warehouseApi.list(), []);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Warehouse>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' } as Partial<Warehouse>);
    setOpen(true);
  };

  const openEdit = (row: Warehouse) => {
    setEditing(row);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await warehouseApi.update(editing.id, values);
        message.success('仓库已更新');
      } else {
        await warehouseApi.create(values as Omit<Warehouse, 'id' | 'code' | 'createdAt'>);
        message.success('仓库已创建');
      }
      setOpen(false);
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: Warehouse) => {
    try {
      await warehouseApi.setStatus(row.id, row.status === 'active' ? 'disabled' : 'active');
      message.success(row.status === 'active' ? '已停用' : '已启用');
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const columns: ColumnsType<Warehouse> = [
    { title: '编号', dataIndex: 'code', width: 100, render: (v) => <span className="sm-mono">{v}</span> },
    { title: '仓库名称', dataIndex: 'name', width: 140 },
    { title: '地址', dataIndex: 'address', ellipsis: true },
    { title: '负责人', dataIndex: 'manager', width: 100 },
    { title: '电话', dataIndex: 'phone', width: 130, render: (v) => <span className="sm-mono">{v}</span> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: Warehouse['status']) => (v === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 110, render: (v) => fmtDate(v) },
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
            onClick={() => navigate(`/catalog/stock?warehouseId=${row.id}`)}
          >
            查看库存
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title={row.status === 'active' ? '确认停用该仓库？' : '确认启用该仓库？'}
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
        title="仓库管理"
        description="仓库是库存查询与收货入库的选择维度；有库存的仓库不能停用"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建仓库
          </Button>
        }
      />

            <ModuleTabs items={CATALOG_TABS} />

      <div className="sm-table-wrap">
        <Table<Warehouse>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data ?? []}
          scroll={{ x: 1080 }}
          locale={{ emptyText: '还没有仓库' }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
        />
      </div>

      <Drawer
        title={editing ? '编辑仓库' : '新建仓库'}
        width={460}
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
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: '请输入仓库名称' }]}>
            <Input placeholder="例如：华中仓" />
          </Form.Item>
          <Form.Item name="address" label="地址" rules={[{ required: true, message: '请输入地址' }]}>
            <Input placeholder="省市区 + 详细地址" />
          </Form.Item>
          <Form.Item name="manager" label="负责人" rules={[{ required: true, message: '请输入负责人' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="联系电话"
            rules={[
              { required: true, message: '请输入电话' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: '启用', value: 'active' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
