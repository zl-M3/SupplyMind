import type { ModuleTabItem } from '@/components/ModuleTabs';

/** 商品与库存模块的二级导航（对应侧边栏分组） */
export const CATALOG_TABS: ModuleTabItem[] = [
  { key: 'products', label: '商品管理', to: '/catalog/products' },
  { key: 'stock', label: '库存总览', to: '/catalog/stock' },
  { key: 'alerts', label: '仓库预警', to: '/catalog/alerts' },
  { key: 'warehouses', label: '仓库管理', to: '/catalog/warehouses' },
  { key: 'transactions', label: '库存流水', to: '/catalog/transactions' },
];
