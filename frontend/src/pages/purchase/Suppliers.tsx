import React, { useState } from 'react';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileTextOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Supplier, SupplierMetrics, SupplierStatus } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { PURCHASE_TABS } from './tabs';
import { SupplierStatusTag } from '@/components/StatusTag';
import { productApi, supplierApi } from '@/services/api';
import { requestAiAttachment } from '@/services/aiAssistant';
import { getToken } from '@/services/http';
import { useRequest } from '@/hooks/useRequest';
import { fmtPercent } from '@/utils/format';

type Row = Supplier & { metrics: SupplierMetrics };

export default function Suppliers() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();

  /** 主营大类与商品大类保持同一套字典，采购下单时才能按大类匹配供应商 */
  const { data: categories } = useRequest(() => productApi.categories().catch(() => []), []);
  const categoryOptions = (categories ?? []).map((c) => ({ label: c, value: c }));

  const [keyword, setKeyword] = useState(params.get('keyword') ?? '');
  const [status, setStatus] = useState<string>(params.get('status') ?? '');
  const [query, setQuery] = useState({ keyword: keyword, status, page: 1, pageSize: 10 });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [form] = Form.useForm<Supplier>();

  /** 上传供应商资料 → 后端抽字段 → 回填新建表单 */
  const extractFromFile = async (file: File) => {
    setExtracting(true);
    setProfile(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/v1/ai/dify/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData?.message ?? '上传失败');

      const extractRes = await fetch('/api/v1/ai/extract/supplier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ attachment_id: uploadData.id }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData?.message ?? '识别失败');
      setProfile(extractData);
      message.success('资料已识别，确认后填入表单');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '识别失败');
    } finally {
      setExtracting(false);
    }
  };

  const { data, loading, reload } = useRequest(
    () => supplierApi.list(query),
    [query.keyword, query.status, query.page, query.pageSize],
  );

  const doSearch = () => {
    setQuery({ keyword, status, page: 1, pageSize: query.pageSize });
    setParams((p) => {
      const next = new URLSearchParams(p);
      keyword ? next.set('keyword', keyword) : next.delete('keyword');
      status ? next.set('status', status) : next.delete('status');
      return next;
    });
  };

  /** 条件没变时（只是想刷新一下）直接重新拉取，避免页面一直用旧数据 */
  const searchAndReload = () => {
    const same =
      query.keyword === keyword && query.status === status && query.page === 1;
    doSearch();
    if (same) void reload();
  };

  const reset = () => {
    setKeyword('');
    setStatus('');
    setQuery({ keyword: '', status: '', page: 1, pageSize: 10 });
    setParams(new URLSearchParams());
  };

  const openCreate = (prefill?: Partial<Supplier>) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active', categories: [], ...(prefill ?? {}) } as Partial<Supplier>);
    setFormOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    form.setFieldsValue(row);
    setFormOpen(true);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await supplierApi.update(editing.id, values);
        message.success('供应商已更新');
      } else {
        await supplierApi.create(values as Omit<Supplier, 'id' | 'code' | 'createdAt'>);
        message.success('供应商已创建');
      }
      setFormOpen(false);
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: Row) => {
    try {
      await supplierApi.setStatus(row.id, row.status === 'active' ? 'disabled' : 'active');
      message.success(row.status === 'active' ? '已停用' : '已启用');
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const columns: ColumnsType<Row> = [
    { title: '编号', dataIndex: 'code', width: 92, render: (v) => <span className="sm-mono">{v}</span> },
    {
      title: '供应商名称',
      dataIndex: 'name',
      render: (v, row) => (
        <a onClick={() => navigate(`/purchase/suppliers/${row.id}`)} style={{ fontWeight: 500 }}>
          {v}
        </a>
      ),
    },
    { title: '联系人', dataIndex: 'contact', width: 100 },
    { title: '电话', dataIndex: 'phone', width: 130, render: (v) => <span className="sm-mono">{v}</span> },
    {
      title: '主营大类',
      dataIndex: 'categories',
      width: 170,
      render: (v: string[]) => (
        <Space size={4} wrap>
          {v.map((c) => (
            <Tag key={c} style={{ marginInlineEnd: 0 }}>
              {c}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '合作状态',
      dataIndex: 'status',
      width: 100,
      render: (v: SupplierStatus) => <SupplierStatusTag status={v} />,
    },
    {
      title: '准时交付率',
      dataIndex: 'metrics',
      width: 168,
      render: (m: SupplierMetrics) =>
        m.onTimeRate == null ? (
          <Tooltip title="还没有已签收的订单，交付 1 单后即可统计准时交付率">
            <Tag>数据不足</Tag>
          </Tooltip>
        ) : (
          <Space size={6}>
            <Progress
              percent={Math.round(m.onTimeRate * 100)}
              size="small"
              showInfo={false}
              strokeColor={m.onTimeRate < 0.8 ? '#d4380d' : '#389e0d'}
              style={{ width: 68 }}
            />
            <span style={{ fontSize: 12.5 }}>{fmtPercent(m.onTimeRate)}</span>
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => navigate(`/purchase/suppliers/${row.id}`)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title={row.status === 'active' ? '确认停用该供应商？' : '确认启用该供应商？'}
            okText="确认"
            cancelText="取消"
            onConfirm={() => void toggleStatus(row)}
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
        title="供应商管理"
        description="维护供应商基础资料与履约指标；准时交付率按已完成且存在预计到货时间的订单计算"
      />

            <ModuleTabs items={PURCHASE_TABS} />

      <div className="sm-table-wrap">
        <div className="sm-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            style={{ width: 240 }}
            placeholder="搜索名称 / 联系人 / 电话"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={doSearch}
          />
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="合作状态"
            value={status || undefined}
            onChange={(v) => setStatus(v ?? '')}
            options={[
              { label: '合作中', value: 'active' },
              { label: '已停用', value: 'disabled' },
            ]}
          />
          <Button type="primary" onClick={searchAndReload}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={reset}>
            重置
          </Button>
          <div style={{ flex: 1 }} />
          <Button icon={<FileTextOutlined />} onClick={() => setExtractOpen(true)}>
            AI 识别资料
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            新建供应商
          </Button>
        </div>

        <Table<Row>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.list ?? []}
          scroll={{ x: 1100 }}
          locale={{ emptyText: '还没有供应商，点击右上角新建' }}
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
        title={editing ? '编辑供应商' : '新建供应商'}
        width={520}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        destroyOnClose
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submitForm()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item
            name="name"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="例如：杭州汇通包装材料有限公司" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="contact"
              label="联系人"
              rules={[{ required: true, message: '请输入联系人' }]}
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="phone"
              label="联系电话"
              rules={[
                { required: true, message: '请输入电话' },
                { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
              ]}
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
          </Space>
          <Form.Item
            name="categories"
            label="主营大类"
            rules={[{ required: true, message: '请选择主营大类' }]}
            extra="采购下单时，只有这里勾选的大类才能向该供应商采购"
          >
            <Select
              mode="multiple"
              options={categoryOptions}
              placeholder="可多选，来源于商品大类"
              notFoundContent="还没有商品大类，请先在商品管理中维护"
            />
          </Form.Item>
          <Form.Item name="address" label="地址" rules={[{ required: true, message: '请输入地址' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="status" label="合作状态">
            <Select
              options={[
                { label: '合作中', value: 'active' },
                { label: '已停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="账期、结算方式等" />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title="AI 识别供应商资料"
        open={extractOpen}
        onCancel={() => setExtractOpen(false)}
        footer={null}
        width={680}
        destroyOnClose
      >
        <Upload.Dragger
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg"
          maxCount={1}
          showUploadList={false}
          disabled={extracting}
          beforeUpload={(file) => {
            void extractFromFile(file as File);
            return false;
          }}
        >
          <p style={{ fontSize: 28, color: '#f26522', margin: '8px 0' }}>
            <FileTextOutlined />
          </p>
          <p style={{ margin: 0 }}>把供应商资料拖到这里，或点击选择文件</p>
          <p style={{ fontSize: 12, color: '#a2968a', marginBottom: 0 }}>
            支持 PDF / Word / Excel / TXT / 图片（扫描件可 OCR），单文件 10MB 内
          </p>
        </Upload.Dragger>

        {extracting && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Spin /> <span style={{ marginLeft: 8, color: '#8a8175' }}>正在读取并识别…</span>
          </div>
        )}

        {profile && (
          <div style={{ marginTop: 16 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="供应商">{profile.name ?? '未识别'}</Descriptions.Item>
              <Descriptions.Item label="联系人">{profile.contact ?? '未识别'}</Descriptions.Item>
              <Descriptions.Item label="电话">{profile.phone ?? '未识别'}</Descriptions.Item>
              <Descriptions.Item label="主营大类">
                {(profile.categories ?? []).join('、') || '未识别'}
              </Descriptions.Item>
            </Descriptions>
            {(profile.items ?? []).length > 0 && (
              <Table
                size="small"
                style={{ marginTop: 10 }}
                rowKey={(row: any, index) => `${row.name}-${index}`}
                pagination={false}
                dataSource={profile.items}
                columns={[
                  { title: '物料', dataIndex: 'name' },
                  { title: '单价', dataIndex: 'price', render: (v: number | null) => (v == null ? '-' : `¥${v}`) },
                  {
                    title: '交期',
                    dataIndex: 'lead_days',
                    render: (v: number | null) => (v == null ? '-' : `${v} 天`),
                  },
                  { title: '起订量', dataIndex: 'moq', render: (v: number | null) => (v == null ? '-' : v) },
                ]}
              />
            )}
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <Space>
                <Button
                  onClick={() => {
                    setExtractOpen(false);
                    requestAiAttachment();
                  }}
                >
                  交给小助手分析
                </Button>
                <Button
                  type="primary"
                  onClick={() => {
                    setExtractOpen(false);
                    openCreate({
                      name: profile.name ?? '',
                      contact: profile.contact ?? '',
                      phone: profile.phone ?? '',
                      categories: profile.categories ?? [],
                    });
                  }}
                >
                  填入表单
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
