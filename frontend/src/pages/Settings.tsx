import React, { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  InputNumber,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import type { Role, User } from '@/types';
import PageHeader from '@/components/PageHeader';
import { API_MODE, authApi, demoApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { ROLE_LABEL } from '@/mock/seed';

const ROLE_COLOR: Record<Role, string> = {
  admin: 'blue',
  buyer: 'green',
};

const API_ENDPOINTS: Array<{ method: string; path: string; desc: string }> = [
  { method: 'GET', path: '/api/dashboard/summary', desc: '工作台汇总（KPI / 趋势 / 待办 / 异常 / 洞察）' },
  { method: 'GET', path: '/api/suppliers?keyword&status&page', desc: '供应商列表（含履约指标）' },
  { method: 'POST', path: '/api/suppliers', desc: '新建供应商' },
  { method: 'GET', path: '/api/products', desc: '商品列表' },
  { method: 'GET', path: '/api/stock/overview', desc: '库存总览（含仓库分布、缺口、建议采购量）' },
  { method: 'GET', path: '/api/purchase-orders?status&supplierId', desc: '采购订单列表' },
  { method: 'POST', path: '/api/purchase-orders', desc: '创建采购草稿' },
  { method: 'POST', path: '/api/purchase-orders/:id/submit', desc: '提交审批' },
  { method: 'POST', path: '/api/purchase-orders/:id/approve', desc: '审批通过（创建人 ≠ 审批人）' },
  { method: 'POST', path: '/api/purchase-orders/:id/reject', desc: '驳回（需原因）' },
  { method: 'POST', path: '/api/purchase-orders/:id/receive', desc: '登记收货（事务内更新库存与流水）' },
  { method: 'GET', path: '/api/logistics', desc: '物流列表（自动计算延迟）' },
  { method: 'POST', path: '/api/logistics/:id/events', desc: '写入物流节点（首期仅演示用）' },
  { method: 'POST', path: '/api/transfers', desc: '库存调拨（校验可用库存）' },
  { method: 'GET', path: '/api/inventory-transactions', desc: '库存流水' },
  { method: 'POST', path: '/api/ai/chat', desc: 'AI 对话（返回统一回复结构）' },
  { method: 'POST', path: '/api/ai/tasks/:id/confirm', desc: '确认 Agent 草稿任务' },
  { method: 'GET', path: '/api/ai/reports', desc: 'AI 分析报告' },
];

export default function Settings() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'users');

  const { data: users, loading } = useRequest(() => authApi.users(), []);

  const [safetyFactor, setSafetyFactor] = useState(1);
  const [delayHours, setDelayHours] = useState(24);
  const [approvalThreshold, setApprovalThreshold] = useState(50000);
  const [requireReason, setRequireReason] = useState(true);

  const columns: ColumnsType<User> = [
    { title: '姓名', dataIndex: 'name' },
    { title: '部门', dataIndex: 'department' },
    {
      title: '角色',
      dataIndex: 'role',
      render: (v: Role) => <Tag color={ROLE_COLOR[v]}>{ROLE_LABEL[v]}</Tag>,
    },
    {
      title: '权限范围',
      dataIndex: 'role',
      render: (v: Role) => (
        <span className="sm-muted" style={{ fontSize: 12.5 }}>
          {v === 'admin'
            ? '管理者：全部模块 + 审批；不能审批自己创建的单'
            : '采购员：采购与库存读写，无审批权'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="系统设置"
        description="用户与角色、业务规则参数，以及前端接入后端时的接口对照"
        extra={
          API_MODE === 'mock' && (
          <Popconfirm
            title="重置演示数据？"
            description="会清除所有本地改动，恢复到初始 Mock 数据"
            okText="重置"
            cancelText="取消"
            onConfirm={async () => {
              await demoApi.reset();
              message.success('已重置，正在刷新…');
              setTimeout(() => window.location.reload(), 400);
            }}
          >
            <Button danger icon={<ReloadOutlined />}>
              重置演示数据
            </Button>
          </Popconfirm>
          )
        }
      />

      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            setTab(k);
            setParams({ tab: k });
          }}
          items={[
            {
              key: 'users',
              label: '用户与角色',
              children: (
                <Table<User>
                  rowKey="id"
                  size="small"
                  loading={loading}
                  columns={columns}
                  dataSource={users ?? []}
                  pagination={false}
                />
              ),
            },
            {
              key: 'rules',
              label: '业务规则',
              children: (
                <Space direction="vertical" size={18} style={{ width: '100%', maxWidth: 720 }}>
                  <Alert
                    type="info"
                    showIcon
                    message="MVP 阶段这些参数先固定在前端展示，接入后端后改为系统配置表读取"
                  />
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="安全库存系数">
                      <Space>
                        <InputNumber
                          min={0.5}
                          max={3}
                          step={0.1}
                          value={safetyFactor}
                          onChange={(v) => setSafetyFactor(Number(v ?? 1))}
                        />
                        <span className="sm-muted">倍（建议采购量 = 安全库存 × 系数 − 可用 − 在途）</span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="物流延迟判定">
                      <Space>
                        超过预计到达
                        <InputNumber
                          min={1}
                          max={96}
                          value={delayHours}
                          onChange={(v) => setDelayHours(Number(v ?? 24))}
                        />
                        小时未更新节点即标记延迟
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="审批金额阈值">
                      <Space>
                        <InputNumber
                          min={0}
                          step={1000}
                          value={approvalThreshold}
                          onChange={(v) => setApprovalThreshold(Number(v ?? 0))}
                          addonBefore="¥"
                        />
                        <span className="sm-muted">超过该金额必须由管理者审批</span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="驳回必填原因">
                      <Switch checked={requireReason} onChange={setRequireReason} />
                    </Descriptions.Item>
                  </Descriptions>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    注：以上参数在本版仅用于展示规则含义，保存后不影响 Mock 计算逻辑。
                  </Typography.Text>
                </Space>
              ),
            },
            {
              key: 'api',
              label: '接口对接说明',
              children: (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Alert
                    type="success"
                    showIcon
                    message="前端已按「页面只依赖 services/api.ts」的方式组织，接后端时不需要改 UI"
                    description="把 services/api.ts 中每个函数体替换成 fetch 调用即可；返回结构保持不变，页面自动生效。删掉 mock/db.ts 的 localStorage 持久化即可。"
                  />
                  <Table
                    rowKey="path"
                    size="small"
                    pagination={false}
                    dataSource={API_ENDPOINTS}
                    columns={[
                      {
                        title: '方法',
                        dataIndex: 'method',
                        width: 80,
                        render: (v) => <Tag color={v === 'GET' ? 'blue' : 'green'}>{v}</Tag>,
                      },
                      {
                        title: '路径',
                        dataIndex: 'path',
                        render: (v) => <span className="sm-mono">{v}</span>,
                      },
                      { title: '说明', dataIndex: 'desc' },
                    ]}
                  />
                  <Card size="small" title="前端目录结构">
                    <pre className="sm-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.8 }}>
{`src/
├─ layout/        统一布局、侧边导航、全局 AI 抽屉
├─ pages/         业务页面（dashboard / purchase / catalog / ai）
├─ components/    通用组件（状态标签、AI 回复、图表）
├─ services/
│  ├─ api.ts      所有接口的唯一出口 ← 只改这里
│  └─ rules.ts    业务规则（库存状态、补货公式、履约指标）
├─ mock/
│  ├─ seed.ts     种子数据（13~15 张表对应的实体）
│  ├─ db.ts       内存 + localStorage 仓储
│  └─ agent.ts    Mock Agent（7 个工具 + 意图识别）
├─ hooks/         useRequest
└─ types.ts       领域模型 = 前后端契约`}
                    </pre>
                  </Card>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}


