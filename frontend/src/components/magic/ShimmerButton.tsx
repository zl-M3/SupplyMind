import React from 'react';
import { Button } from 'antd';
import type { ButtonProps } from 'antd';

/**
 * ShimmerButton（Magic UI 等价）：主 CTA，带光带扫过的渐变按钮。
 * 保留 antd Button 的可访问性与 loading 行为，只叠加视觉层。
 */
export function ShimmerButton(props: ButtonProps) {
  const { className, children, ...rest } = props;
  return (
    <Button
      type="primary"
      className={`sm-shimmer-btn ${className ?? ''}`}
      {...rest}
    >
      {children}
    </Button>
  );
}

export default ShimmerButton;
