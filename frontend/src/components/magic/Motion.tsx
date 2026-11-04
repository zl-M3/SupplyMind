import React from 'react';

/** BlurFade（Magic UI 等价）：入场时模糊+位移淡入，支持 delay 做交错 */
export function BlurFade({
  children,
  delay = 0,
  className = '',
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`sm-blur-fade ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

/** BorderBeam（Magic UI 等价）：卡片边框上流转的光点 */
export function BorderBeam({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`sm-beam ${className}`} style={style}>
      {children}
    </div>
  );
}

/** DotPattern（Magic UI 等价）：点阵底纹，用作 hero 区装饰 */
export function DotPattern({ className = '' }: { className?: string }) {
  return <div className={`sm-dot-pattern ${className}`} aria-hidden="true" />;
}

export default BlurFade;
