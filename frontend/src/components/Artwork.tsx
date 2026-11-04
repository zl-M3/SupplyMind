import React from 'react';

/**
 * 手绘 SVG 插画（替代参考图里的 3D 机器人位图）
 * 用 SVG 的好处：不依赖外部图片、可随主题变色、体积远小于位图。
 */

export function RobotMascot({ size = 54 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="AI 助手"
    >
      <defs>
        <linearGradient id="rm-body" x1="14" y1="18" x2="50" y2="52">
          <stop offset="0%" stopColor="#FFB077" />
          <stop offset="100%" stopColor="#F26522" />
        </linearGradient>
        <linearGradient id="rm-face" x1="18" y1="20" x2="46" y2="40">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#FFF1E4" />
        </linearGradient>
      </defs>

      {/* 天线 */}
      <line x1="32" y1="6" x2="32" y2="12" stroke="#F26522" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3" fill="#FFC48F" />

      {/* 头 */}
      <rect x="12" y="12" width="40" height="30" rx="12" fill="url(#rm-body)" />
      <rect x="16" y="16" width="32" height="21" rx="9" fill="url(#rm-face)" />

      {/* 眼睛 */}
      <circle cx="26" cy="26" r="3.1" fill="#3B2A1E" />
      <circle cx="38" cy="26" r="3.1" fill="#3B2A1E" />
      <circle cx="27.1" cy="25" r="1" fill="#fff" />
      <circle cx="39.1" cy="25" r="1" fill="#fff" />

      {/* 微笑 */}
      <path d="M28 31.5c1.6 1.8 6.4 1.8 8 0" stroke="#F0A16A" strokeWidth="1.7" strokeLinecap="round" />

      {/* 耳朵 */}
      <rect x="7" y="22" width="4" height="11" rx="2" fill="#FFC48F" />
      <rect x="53" y="22" width="4" height="11" rx="2" fill="#FFC48F" />

      {/* 身体 */}
      <rect x="18" y="44" width="28" height="14" rx="7" fill="url(#rm-body)" opacity="0.92" />
      <circle cx="26" cy="51" r="2" fill="#fff" opacity="0.85" />
      <circle cx="32" cy="51" r="2" fill="#fff" opacity="0.62" />
      <circle cx="38" cy="51" r="2" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** 登录页左侧的抽象仓储场景线稿 */
export function HeroScene({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 300"
      fill="none"
      aria-hidden="true"
      style={{ width: '100%', height: '100%' }}
    >
      <defs>
        <linearGradient id="hs-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFD9B8" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="hs-truck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#FFE3CC" />
        </linearGradient>
      </defs>

      {/* 地面线 */}
      <path d="M20 252h380" stroke="#F5C9A4" strokeWidth="2" strokeLinecap="round" />

      {/* 仓库主体 */}
      <rect x="70" y="112" width="176" height="140" rx="10" fill="url(#hs-glass)" stroke="#F2C39C" strokeWidth="2" />
      <path d="M62 114 158 68l96 46" stroke="#F2C39C" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <rect x="96" y="150" width="40" height="34" rx="5" fill="#FFE0C4" />
      <rect x="150" y="150" width="40" height="34" rx="5" fill="#FFE0C4" />
      <rect x="96" y="196" width="40" height="34" rx="5" fill="#FFE0C4" />
      <rect x="150" y="196" width="40" height="34" rx="5" fill="#FFE0C4" />

      {/* 货车 */}
      <rect x="262" y="176" width="94" height="54" rx="8" fill="url(#hs-truck)" stroke="#EFC09A" strokeWidth="2" />
      <path d="M356 196h26l14 20v14h-40z" fill="url(#hs-truck)" stroke="#EFC09A" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="292" cy="234" r="10" fill="#FFF" stroke="#F26522" strokeWidth="2.4" />
      <circle cx="372" cy="234" r="10" fill="#FFF" stroke="#F26522" strokeWidth="2.4" />
      <line x1="262" y1="206" x2="356" y2="206" stroke="#F0C7A5" strokeWidth="1.6" />

      {/* 货箱堆 */}
      <rect x="34" y="212" width="30" height="30" rx="4" fill="#FFEFE0" stroke="#F2C39C" strokeWidth="1.8" />
      <rect x="40" y="188" width="22" height="22" rx="4" fill="#FFF7EF" stroke="#F5D2B4" strokeWidth="1.8" />

      {/* 装饰点 */}
      <circle cx="392" cy="96" r="5" fill="#FFC48F" />
      <circle cx="352" cy="132" r="3" fill="#FFD9B8" />
      <circle cx="46" cy="132" r="3.5" fill="#FFD9B8" />
    </svg>
  );
}

/** hero 区右侧的抽象光晕装饰 */
export function HeroGlow() {
  return (
    <div className="sm-hero-art" aria-hidden="true">
      <div
        style={{
          position: 'absolute',
          right: -40,
          top: -60,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,170,110,.35), transparent 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 60,
          bottom: -70,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,214,170,.5), transparent 70%)',
        }}
      />
    </div>
  );
}
