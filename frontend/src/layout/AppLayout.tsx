import React, { useMemo, useState } from 'react';
import { App, Alert, Avatar, Badge, Button, Dropdown, Empty, Input, Layout, Menu, Popover, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authApi, dashboardApi, stockApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { useCurrentUser, resetCurrentUserCache } from '@/hooks/useCurrentUser';
import RoleGate from '@/components/RoleGate';
import AiAssistantFab from '@/components/AiAssistantFab';

const { Sider, Header, Content } = Layout;

const MENU_MAP: Record<string, string> = {
  '/dashboard': '工作台',
  '/purchase/suppliers': '供应商管理',
  '/purchase/orders': '采购订单',
  '/purchase/logistics': '物流跟踪',
  '/catalog/products': '商品管理',
  '/catalog/stock': '库存总览',
  '/catalog/alerts': '仓库预警',
  '/catalog/warehouses': '仓库管理',
  '/catalog/transactions': '库存流水',
  '/ai/chat': 'AI 对话',
  '/ai/tasks': 'Agent 任务中心',
  '/ai/reports': 'AI 分析报告',
  '/settings': '系统设置',
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const [collapsed, setCollapsed] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  /** 后端接口不可用时的错误信息：避免"看着是旧数据但其实请求全失败" */
  const [apiOffline, setApiOffline] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setApiOffline(detail?.message ?? '后端接口请求失败');
    };
    const onOk = () => setApiOffline(null);
    window.addEventListener('sm:api-error', onError);
    window.addEventListener('sm:api-ok', onOk);
    return () => {
      window.removeEventListener('sm:api-error', onError);
      window.removeEventListener('sm:api-ok', onOk);
    };
  }, []);

  const { data: alerts } = useRequest(() => stockApi.alerts(), []);
  const { data: summary } = useRequest(() => dashboardApi.summary().catch(() => null), []);
  const [notifyOpen, setNotifyOpen] = useState(false);

  /** 通知中心：把待审批 / 待收货 / 物流异常 / 库存预警汇总成一条列表 */
  const notifications = useMemo(() => {
    const list: Array<{ key: string; icon: string; tone: string; text: string; meta: string; to: string }> = [];
    (summary?.todos.pendingApproval ?? []).slice(0, 3).forEach((po) => {
      list.push({
        key: `pa-${po.id}`,
        icon: '审',
        tone: '#f59e0b',
        text: `待审批 ${po.code} · ${po.supplierName ?? ''}`,
        meta: '审批后进入履约',
        to: `/purchase/orders/${po.id}`,
      });
    });
    (summary?.todos.toReceive ?? []).slice(0, 2).forEach((po) => {
      list.push({
        key: `tr-${po.id}`,
        icon: '收',
        tone: '#3b82f6',
        text: `待收货 ${po.code}`,
        meta: `预计 ${po.expectedArrival ?? ''}`,
        to: `/purchase/orders/${po.id}`,
      });
    });
    (summary?.todos.logisticsException ?? []).slice(0, 2).forEach((lo) => {
      list.push({
        key: `lo-${lo.id}`,
        icon: '延',
        tone: '#ef4444',
        text: `物流异常 ${lo.code} · ${lo.carrier ?? ''}`,
        meta: '已超预计到达时间',
        to: `/purchase/logistics/${lo.id}`,
      });
    });
    (alerts ?? []).slice(0, 4).forEach((row) => {
      list.push({
        key: `st-${row.productId}`,
        icon: '库',
        tone: row.level === 'out' ? '#ef4444' : '#f59e0b',
        text: `${row.productName} 库存 ${row.totalQty}/${row.safetyStock}`,
        meta: row.level === 'out' ? '缺货，建议补货' : '低于安全库存',
        to: '/catalog/alerts',
      });
    });
    return list.slice(0, 9);
  }, [summary, alerts]);

  const me = useCurrentUser();
  /** 采购员（SALES）只负责采购执行：仅保留「采购订单」「物流跟踪」，其余菜单隐藏 */
  const isBuyer = me?.role === 'buyer';

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (MENU_MAP[path]) return path;
    if (path.startsWith('/purchase/orders')) return '/purchase/orders';
    if (path.startsWith('/purchase/suppliers')) return '/purchase/suppliers';
    if (path.startsWith('/purchase/logistics')) return '/purchase/logistics';
    if (path.startsWith('/catalog/products')) return '/catalog/products';
    return path;
  }, [location.pathname]);

  const [openKeys, setOpenKeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    const group = selectedKey.startsWith('/purchase')
      ? 'purchase'
      : selectedKey.startsWith('/catalog')
        ? 'catalog'
        : selectedKey.startsWith('/ai')
          ? 'ai'
          : '';
    if (group) setOpenKeys((prev) => (prev.includes(group) ? prev : [...prev, group]));
  }, [selectedKey]);

  const doSearch = () => {
    const kw = keyword.trim();
    navigate(kw ? `/purchase/orders?keyword=${encodeURIComponent(kw)}` : '/purchase/orders');
  };

  /**
   * 侧边栏菜单
   * 角色 = 采购员（buyer / SALES）：只保留「采购订单」「物流跟踪」，
   * 工作台、供应商管理、商品与库存、AI 智能中心全部隐藏。
   */
  const menuItems = useMemo<NonNullable<MenuProps['items']>>(() => {
    if (isBuyer) {
      return [
        {
          key: 'purchase',
          icon: <ShoppingCartOutlined />,
          label: '采购管理',
          children: [
            { key: '/purchase/orders', icon: <ShoppingCartOutlined />, label: '采购订单' },
            { key: '/purchase/logistics', icon: <InboxOutlined />, label: '物流跟踪' },
          ],
        },
      ];
    }

    return [
      { key: '/dashboard', icon: <AppstoreOutlined />, label: '工作台' },
      {
        key: 'purchase',
        icon: <ShoppingCartOutlined />,
        label: '采购管理',
        children: [
          { key: '/purchase/suppliers', icon: <ShopOutlined />, label: '供应商管理' },
          { key: '/purchase/orders', icon: <ShoppingCartOutlined />, label: '采购订单' },
          { key: '/purchase/logistics', icon: <InboxOutlined />, label: '物流跟踪' },
        ],
      },
      {
        key: 'catalog',
        icon: <DatabaseOutlined />,
        label: '商品与库存',
        children: [
          { key: '/catalog/products', icon: <ExperimentOutlined />, label: '商品管理' },
          { key: '/catalog/stock', icon: <DatabaseOutlined />, label: '库存总览' },
          {
            key: '/catalog/alerts',
            icon: <WarningOutlined />,
            label: (
              <span>
                仓库预警
                {!!alerts?.length && <Badge count={alerts.length} size="small" style={{ marginLeft: 6 }} />}
              </span>
            ),
          },
          { key: '/catalog/warehouses', icon: <ShopOutlined />, label: '仓库管理' },
          { key: '/catalog/transactions', icon: <BarChartOutlined />, label: '库存流水' },
        ],
      },
      {
        key: 'ai',
        icon: <RobotOutlined />,
        label: 'AI 智能中心',
        children: [
          { key: '/ai/chat', icon: <RobotOutlined />, label: 'AI 对话' },
          {
            key: '/ai/tasks',
            icon: <AppstoreOutlined />,
            disabled: true,
            label: (
              <Tooltip title="开发中">
                <span>Agent 任务中心</span>
              </Tooltip>
            ),
          },
          {
            key: '/ai/reports',
            icon: <FileTextOutlined />,
            disabled: true,
            label: (
              <Tooltip title="开发中">
                <span>AI 分析报告</span>
              </Tooltip>
            ),
          },
        ],
      },
    ];
  }, [isBuyer, alerts]);

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--sm-bg)' }}>
      <Sider
        className="sm-sider"
        width={218}
        collapsedWidth={68}
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="light"
      >
        <div className="sm-logo" style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div className="sm-logo-mark sm-logo-mark--photo">
            <img src="/icon.png" alt="" aria-hidden="true" />
          </div>
          {!collapsed && (
            <div className="sm-logo-text">
              <span className="sm-logo-name">SupplyMind</span>
              <span className="sm-logo-sub">AI 智能供应链平台</span>
            </div>
          )}
        </div>

        <div className="sm-sider-menu">
          <Menu
            mode="inline"
            theme="light"
            selectedKeys={[selectedKey]}
            openKeys={collapsed ? undefined : openKeys}
            onOpenChange={(keys) => setOpenKeys(keys as string[])}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
            onClick={({ key }) => navigate(key)}
            items={menuItems}
          />
        </div>
      </Sider>

      <Layout style={{ background: 'transparent' }}>
        <Header className="sm-header">
          <Button
            type="text"
            aria-label={collapsed ? '展开菜单' : '收起菜单'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((c) => !c)}
          />

          <div className="sm-search">
            <Input
              allowClear
              placeholder="搜索订单、商品、供应商…"
              prefix={<SearchOutlined style={{ color: 'var(--sm-muted-2)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={doSearch}
            />
          </div>

          <div style={{ flex: 1 }} />

          {!isBuyer && (
            <Popover
              open={notifyOpen}
              onOpenChange={setNotifyOpen}
              trigger="click"
              placement="bottomRight"
              content={
                <div style={{ width: 320 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>通知</strong>
                    <span style={{ fontSize: 11.5, color: '#a2968a' }}>{notifications.length} 条待处理</span>
                  </div>
                  {notifications.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理事项" />
                  ) : (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {notifications.map((item) => (
                        <div
                          key={item.key}
                          onClick={() => {
                            setNotifyOpen(false);
                            navigate(item.to);
                          }}
                          style={{
                            display: 'flex',
                            gap: 8,
                            padding: '8px 6px',
                            borderRadius: 8,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#fff6ef';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              background: item.tone,
                              color: '#fff',
                              fontSize: 11,
                              display: 'grid',
                              placeItems: 'center',
                              flex: 'none',
                            }}
                          >
                            {item.icon}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: '#2b2420',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {item.text}
                            </div>
                            <div style={{ fontSize: 11, color: '#a2968a' }}>{item.meta}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid #f5ede4', marginTop: 6, paddingTop: 6, textAlign: 'right' }}>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setNotifyOpen(false);
                        navigate('/catalog/alerts');
                      }}
                    >
                      查看全部
                    </Button>
                  </div>
                </div>
              }
            >
              <Badge count={notifications.length} size="small" offset={[-2, 2]}>
                <Button type="text" aria-label="通知中心" icon={<BellOutlined />} />
              </Badge>
            </Popover>
          )}

          <Dropdown
            menu={{
              items: isBuyer
                ? [
                    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
                  ]
                : [
                    { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
                    { key: 'api', icon: <ReloadOutlined />, label: '接口对接说明' },
                    { type: 'divider' },
                    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
                  ],
              onClick: async ({ key }) => {
                if (key === 'settings') navigate('/settings');
                if (key === 'api') navigate('/settings?tab=api');
                if (key === 'logout') {
                  await authApi.logout();
                  resetCurrentUserCache();
                  message.success('已退出登录');
                  navigate('/login', { replace: true });
                }
              },
            }}
          >
            <div className="sm-header-user">
              <Avatar
                size={30}
                style={{
                  background: 'linear-gradient(135deg,#FFB077,#F26522)',
                  fontSize: 13,
                }}
              >
                {(me?.name ?? '张伟').slice(0, 1)}
              </Avatar>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{me?.name ?? '张伟'}</span>
              <Tag
                bordered={false}
                color={me?.role === 'admin' ? 'orange' : 'default'}
                style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}
              >
                {me?.role === 'admin' ? '管理者' : '采购员'}
              </Tag>
              <SettingOutlined style={{ fontSize: 12, color: 'var(--sm-muted-2)' }} />
            </div>
          </Dropdown>
        </Header>

        <Content style={{ overflow: 'auto' }}>
          <div className="sm-content">
            {apiOffline && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 14 }}
                message="后端接口连不上，页面显示的是上一次的数据"
                description={`${apiOffline}（后端需监听 127.0.0.1:8000，前端 /api 由 Vite 代理转发）`}
                action={
                  <Button size="small" onClick={() => window.location.reload()}>
                    重新加载
                  </Button>
                }
              />
            )}
            <RoleGate>
              <Outlet />
            </RoleGate>
          </div>
        </Content>
      </Layout>

      <AiAssistantFab />
    </Layout>
  );
}






