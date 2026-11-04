import type { ModuleTabItem } from '@/components/ModuleTabs';

/** 采购管理模块的二级导航 */
export const PURCHASE_TABS: ModuleTabItem[] = [
  { key: 'suppliers', label: '供应商', to: '/purchase/suppliers' },
  { key: 'orders', label: '采购订单', to: '/purchase/orders' },
  { key: 'logistics', label: '物流跟踪', to: '/purchase/logistics' },
];
