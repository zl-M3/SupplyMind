import React from 'react';
import { Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

export interface ModuleTabItem {
  key: string;
  label: string;
  /** 路由路径，点击跳转 */
  to: string;
  badge?: number;
  /** 暂停使用的功能：置灰、不可点击 */
  disabled?: boolean;
  /** 置灰原因，hover 时提示 */
  disabledTip?: string;
}

/**
 * 胶囊型模块切换 Tab（对应参考图「供应商 / 采购订单 / 物流跟踪」那一排）。
 * 用路由驱动，天然支持深链和刷新保持。
 */
export default function ModuleTabs({ items }: { items: ModuleTabItem[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activeKey =
    items.find((i) => pathname === i.to)?.key ??
    items.find((i) => pathname.startsWith(i.to))?.key ??
    items[0]?.key;

  return (
    <div className="sm-tabs" role="tablist">
      {items.map((item) => {
        const active = item.key === activeKey;
        const button = (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={item.disabled}
            disabled={item.disabled}
            className={`sm-tab ${active ? 'sm-tab--active' : ''} ${item.disabled ? 'sm-tab--disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) navigate(item.to);
            }}
          >
            {item.label}
            {item.badge ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '0 6px',
                  borderRadius: 999,
                  background: active ? 'rgba(255,255,255,.28)' : 'var(--sm-red-soft)',
                  color: active ? '#fff' : 'var(--sm-red)',
                }}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );

        return item.disabled ? (
          <Tooltip key={item.key} title={item.disabledTip ?? '开发中'}>
            <span style={{ display: 'inline-flex' }}>{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
