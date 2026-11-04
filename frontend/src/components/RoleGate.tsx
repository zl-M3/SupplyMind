import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * 角色级页面守卫
 *
 * 采购员（SALES）只负责采购执行：仅可访问「采购订单」与「物流跟踪」。
 * 其余页面（工作台 / 供应商管理 / 商品与库存 / AI 智能中心 / 系统设置）
 * 在侧边栏隐藏，同时这里挡住直接输入 URL 的访问，避免"藏了菜单还能进页面"。
 *
 * 管理者（GM）不受限制。
 */

const ALLOWED_PREFIXES = ['/purchase/orders', '/purchase/logistics'];

export default function RoleGate({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const { pathname } = useLocation();

  // 用户信息未就绪（或未登录）时不做拦截，交给 RequireAuth 处理
  if (!user || user.role === 'admin') return <>{children}</>;

  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return allowed ? <>{children}</> : <Navigate to="/purchase/orders" replace />;
}
