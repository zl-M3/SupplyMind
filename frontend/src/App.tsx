import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { AiProvider } from './layout/AiContext';
import Dashboard from './pages/Dashboard';
import Suppliers from './pages/purchase/Suppliers';
import SupplierDetail from './pages/purchase/SupplierDetail';
import PurchaseOrders from './pages/purchase/PurchaseOrders';
import PurchaseOrderDetail from './pages/purchase/PurchaseOrderDetail';
import Logistics from './pages/purchase/Logistics';
import LogisticsDetail from './pages/purchase/LogisticsDetail';
import Products from './pages/catalog/Products';
import Stock from './pages/catalog/Stock';
import StockAlerts from './pages/catalog/StockAlerts';
import Warehouses from './pages/catalog/Warehouses';
import Transactions from './pages/catalog/Transactions';
import AiChat from './pages/ai/AiChat';
import AiTasks from './pages/ai/AiTasks';
import AiReports from './pages/ai/AiReports';
import AiKnowledge from './pages/ai/AiKnowledge';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { API_MODE } from './services/api';
import { getToken, setToken } from './services/http';

/** 真实后端模式下要求先登录；mock 模式直接放行 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  if (API_MODE === 'mock') return <>{children}</>;
  // 仅开发环境：允许用 ?token=xxx 注入登录态，方便截图与联调
  if (import.meta.env.DEV) {
    const injected = new URLSearchParams(window.location.search).get('token');
    if (injected) setToken(injected);
  }
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="检查一下地址，或者回到工作台"
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          回到工作台
        </Button>
      }
    />
  );
}

/** 布局外面套一层错误边界，按路由重置，某个页面崩了不影响整体 */
function LayoutWithBoundary() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <AppLayout />
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <AiProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><LayoutWithBoundary /></RequireAuth>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/purchase/suppliers" element={<Suppliers />} />
          <Route path="/purchase/suppliers/:id" element={<SupplierDetail />} />
          <Route path="/purchase/orders" element={<PurchaseOrders />} />
          <Route path="/purchase/orders/:id" element={<PurchaseOrderDetail />} />
          <Route path="/purchase/logistics" element={<Logistics />} />
          <Route path="/purchase/logistics/:id" element={<LogisticsDetail />} />
          <Route path="/catalog/products" element={<Products />} />
          <Route path="/catalog/stock" element={<Stock />} />
          <Route path="/catalog/alerts" element={<StockAlerts />} />
          <Route path="/catalog/warehouses" element={<Warehouses />} />
          <Route path="/catalog/transactions" element={<Transactions />} />
          <Route path="/ai/chat" element={<AiChat />} />
          <Route path="/ai/tasks" element={<AiTasks />} />
          <Route path="/ai/reports" element={<AiReports />} />
          <Route path="/ai/knowledge" element={<AiKnowledge />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AiProvider>
  );
}


