import React, { useState } from 'react';
import { App, Button, Checkbox, Form, Input } from 'antd';
import {
  AlipayOutlined,
  BarChartOutlined,
  GithubOutlined,
  InboxOutlined,
  LeftOutlined,
  LockOutlined,
  MobileOutlined,
  SafetyOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/services/api';
import { resetCurrentUserCache } from '@/hooks/useCurrentUser';
import './Login.css';

/** 左侧文案轮播：点击箭头切换 */
const SLIDES = [
  { lines: ['让供应链更智能', '让经营更高效'], sub: '数据驱动 · 智能决策 · 业务闭环' },
  { lines: ['让采购更省心', '让履约更可靠'], sub: '询价比价 · 审批到货 · 全程可视' },
  { lines: ['让库存更精准', '让周转更健康'], sub: '实时库存 · 智能补货 · 风险预警' },
];

/** 底部仓储场景（SVG 手绘，替代实景照片，零外部资源） */
function WarehouseScene() {
  return (
    <svg viewBox="0 0 900 380" role="img" aria-label="现代化仓储与配送场景">
      <defs>
        <linearGradient id="lg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF3E2" stopOpacity="0" />
          <stop offset="100%" stopColor="#FFD9B0" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="lg-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3E4D3" />
        </linearGradient>
        <linearGradient id="lg-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFE2BE" />
          <stop offset="60%" stopColor="#FFC98E" />
          <stop offset="100%" stopColor="#FFB871" />
        </linearGradient>
        <linearGradient id="lg-truck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F6EADC" />
        </linearGradient>
        <linearGradient id="lg-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE7CB" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFDDBB" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lg-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFE9CE" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 天光 */}
      <rect x="0" y="0" width="900" height="380" fill="url(#lg-sky)" />
      <ellipse cx="620" cy="70" rx="240" ry="90" fill="url(#lg-glow)" />

      {/* 地面 */}
      <rect x="0" y="318" width="900" height="62" fill="url(#lg-ground)" />
      <path d="M0 318h900" stroke="#F2C9A2" strokeWidth="1.6" strokeLinecap="round" />

      {/* 远景仓库（浅色，制造纵深） */}
      <g opacity="0.5">
        <rect x="20" y="196" width="150" height="122" rx="4" fill="#FFF6EB" />
        <path d="M20 196 95 168 170 196" fill="#FFF9F1" stroke="#F0DAC2" strokeWidth="1.4" />
        <rect x="44" y="232" width="26" height="30" rx="2" fill="#FFE6C9" />
        <rect x="88" y="232" width="26" height="30" rx="2" fill="#FFE6C9" />
        <rect x="132" y="232" width="26" height="30" rx="2" fill="#FFE6C9" />
      </g>

      {/* 主仓库 */}
      <g>
        {/* 主体 */}
        <rect x="238" y="150" width="330" height="168" rx="5" fill="url(#lg-wall)" />
        {/* 屋顶 */}
        <path d="M228 152 403 96 578 152Z" fill="#FFFDF9" stroke="#EBD6BF" strokeWidth="1.6" />
        <path d="M403 96v-14" stroke="#E7CDB2" strokeWidth="2" strokeLinecap="round" />
        {/* 玻璃立面 */}
        <rect x="262" y="170" width="282" height="96" rx="4" fill="url(#lg-glass)" opacity="0.92" />
        {/* 玻璃分格 */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`v${i}`}
            x1={262 + 47 + i * 47}
            y1="170"
            x2={262 + 47 + i * 47}
            y2="266"
            stroke="#FFFFFF"
            strokeOpacity="0.7"
            strokeWidth="2"
          />
        ))}
        {[0, 1].map((i) => (
          <line
            key={`h${i}`}
            x1="262"
            y1={202 + i * 32}
            x2="544"
            y2={202 + i * 32}
            stroke="#FFFFFF"
            strokeOpacity="0.7"
            strokeWidth="2"
          />
        ))}
        {/* 卸货雨棚 */}
        <rect x="238" y="266" width="330" height="12" fill="#F7E7D6" />
        <rect x="238" y="278" width="330" height="40" fill="#FBF0E4" />
        {/* 卷帘门 */}
        <rect x="330" y="282" width="86" height="36" rx="2" fill="#F0DCC6" />
        <line x1="330" y1="294" x2="416" y2="294" stroke="#E4CBB1" strokeWidth="1.5" />
        <line x1="330" y1="306" x2="416" y2="306" stroke="#E4CBB1" strokeWidth="1.5" />
        {/* 招牌 */}
        <rect x="430" y="128" width="86" height="16" rx="3" fill="#F26522" opacity="0.85" />
        {/* 站台 */}
        <rect x="238" y="308" width="330" height="10" fill="#EFD9C1" />
      </g>

      {/* 货车 */}
      <g>
        {/* 车厢 */}
        <rect x="596" y="222" width="188" height="86" rx="6" fill="url(#lg-truck)" stroke="#EBD8C3" strokeWidth="1.6" />
        <line x1="690" y1="222" x2="690" y2="308" stroke="#EFDECB" strokeWidth="1.4" />
        {/* 驾驶室 */}
        <path
          d="M784 246h44l22 30v32h-66z"
          fill="#FFFFFF"
          stroke="#EBD8C3"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M790 252h30l16 22h-46z" fill="#FFD9AE" opacity="0.9" />
        {/* 车轮 */}
        <circle cx="642" cy="312" r="15" fill="#FFF" stroke="#F26522" strokeWidth="3" />
        <circle cx="642" cy="312" r="4.5" fill="#F26522" opacity="0.55" />
        <circle cx="806" cy="312" r="15" fill="#FFF" stroke="#F26522" strokeWidth="3" />
        <circle cx="806" cy="312" r="4.5" fill="#F26522" opacity="0.55" />
        <circle cx="730" cy="312" r="15" fill="#FFF" stroke="#F26522" strokeWidth="3" />
        <circle cx="730" cy="312" r="4.5" fill="#F26522" opacity="0.55" />
        {/* 车头灯 */}
        <rect x="846" y="296" width="10" height="7" rx="2" fill="#FFC98A" />
        {/* 车身高光 */}
        <path d="M604 232h172" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      </g>

      {/* 货物堆 */}
      <g>
        <rect x="560" y="278" width="30" height="30" rx="3" fill="#FFF4E7" stroke="#EBD3B9" strokeWidth="1.4" />
        <rect x="564" y="252" width="22" height="22" rx="3" fill="#FFF9F2" stroke="#F0DAC2" strokeWidth="1.4" />
        <rect x="596" y="288" width="20" height="20" rx="3" fill="#FFF4E7" stroke="#EBD3B9" strokeWidth="1.4" />
      </g>

      {/* 前景绿植 */}
      <g opacity="0.55">
        <ellipse cx="70" cy="352" rx="58" ry="26" fill="#CFE3C4" />
        <ellipse cx="128" cy="362" rx="46" ry="20" fill="#DCEBD3" />
        <ellipse cx="856" cy="358" rx="52" ry="22" fill="#DCEBD3" />
      </g>
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [mode, setMode] = useState<'password' | 'sms'>('password');
  const [slide, setSlide] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const current = SLIDES[slide];

  const submit = async () => {
    let values: { account?: string; password?: string; mobile?: string; code?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setLoading(true);
    try {
      resetCurrentUserCache();
      let user;
      if (mode === 'password') {
        user = await authApi.login(String(values.account ?? ''), String(values.password ?? ''));
      } else {
        // 短信登录后端未开放，演示阶段直接用手机号当账号
        user = await authApi.login(String(values.mobile ?? ''), String(values.code ?? ''));
      }
      message.success('登录成功');
      // 采购员没有工作台权限，直接落在采购订单
      navigate(user?.role === 'buyer' ? '/purchase/orders' : '/dashboard');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sm-login-page">
      {/* ============ 左侧品牌区 ============ */}
      <section className="sm-login-left">
        <div
          className="sm-login-blob"
          style={{ width: 320, height: 320, background: '#FFB98A', right: -90, top: -60, opacity: 0.5 }}
          aria-hidden="true"
        />
        <div
          className="sm-login-blob"
          style={{ width: 240, height: 240, background: '#FFE0BC', left: -70, bottom: 40, animationDelay: '3s', opacity: 0.6 }}
          aria-hidden="true"
        />

        {/* 悬浮功能图标 + 连接弧线 */}
        <div className="sm-hero-chips" aria-hidden="true">
          <svg viewBox="0 0 560 420" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <path
              d="M132 236c46-64 108-96 178-108 66-11 118 4 152 44"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.85"
              strokeWidth="1.6"
              strokeDasharray="7 9"
              strokeLinecap="round"
            />
          </svg>
          <span className="sm-chip" style={{ left: '16%', top: '44%' }}>
            <ShoppingCartOutlined />
          </span>
          <span className="sm-chip sm-chip--sm" style={{ left: '44%', top: '30%', animationDelay: '1.2s' }}>
            <BarChartOutlined />
          </span>
          <span className="sm-chip" style={{ left: '66%', top: '24%', animationDelay: '2.1s' }}>
            <InboxOutlined />
          </span>
        </div>

        <div className="sm-login-brand">
          <div className="sm-logo-mark sm-logo-mark--photo" style={{ width: 38, height: 38 }}>
            <img src="/icon.png" alt="" aria-hidden="true" />
          </div>
          <div className="sm-login-brand-text">
            <div className="sm-login-brand-name">SupplyMind</div>
            <div className="sm-login-brand-sub">AI 智能供应链管理平台</div>
          </div>
        </div>

        <div className="sm-login-hero">
          <h1 className="sm-login-title" key={`t-${slide}`}>
            <em>{current.lines[0]}</em>
            <em>{current.lines[1]}</em>
          </h1>
          <p className="sm-login-sub" key={`s-${slide}`}>
            {current.sub}
          </p>
        </div>

        <button
          type="button"
          className="sm-login-arrow"
          aria-label="切换宣传文案"
          onClick={() => setSlide((s) => (s + 1) % SLIDES.length)}
        >
          <LeftOutlined style={{ fontSize: 14 }} />
        </button>

        <div className="sm-login-scene">
          <WarehouseScene />
        </div>
      </section>

      {/* ============ 右侧登录区 ============ */}
      <section className="sm-login-right">
        <div className="sm-login-card">
          <div className="sm-login-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'password'}
              className={`sm-login-tab ${mode === 'password' ? 'sm-login-tab--active' : ''}`}
              onClick={() => setMode('password')}
            >
              密码登录
            </button>
            <button
              role="tab"
              aria-selected={mode === 'sms'}
              className={`sm-login-tab ${mode === 'sms' ? 'sm-login-tab--active' : ''}`}
              onClick={() => setMode('sms')}
            >
              短信登录
            </button>
          </div>

          <h2 className="sm-login-welcome">欢迎登录  </h2>
          <p className="sm-login-welcome-sub">开启您的智能供应链之旅</p>

          <Form form={form} layout="vertical" requiredMark={false} className="sm-login-form" onFinish={submit}>
            {mode === 'password' ? (
              <>
                <Form.Item name="account" rules={[{ required: true, message: '请输入手机号 / 邮箱' }]}>
                  <Input
                    aria-label="手机号或邮箱"
                    autoComplete="username"
                    prefix={<UserOutlined />}
                    placeholder="请输入手机号/邮箱"
                  />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password
                    aria-label="密码"
                    autoComplete="current-password"
                    prefix={<LockOutlined />}
                    placeholder="请输入密码"
                  />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item name="mobile" rules={[{ required: true, message: '请输入手机号' }]}>
                  <Input
                    aria-label="手机号"
                    autoComplete="tel"
                    inputMode="tel"
                    prefix={<MobileOutlined />}
                    placeholder="请输入手机号"
                  />
                </Form.Item>
                <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]}>
                  <Input
                    aria-label="短信验证码"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    prefix={<SafetyOutlined />}
                    placeholder="请输入验证码"
                    suffix={
                      <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}>
                        获取验证码
                      </Button>
                    }
                  />
                </Form.Item>
              </>
            )}

            <div className="sm-login-forgot">
              <a onClick={() => message.info('找回密码为演示占位')}>忘记密码？</a>
            </div>

            <Button
              htmlType="submit"
              block
              loading={loading}
              className="sm-login-submit sm-shimmer-btn"
            >
              登录 →
            </Button>
          </Form>

          <div className="sm-login-divider">或 使用其他方式登录</div>

          <div className="sm-login-social">
            <button
              type="button"
              className="sm-social-btn sm-social-btn--wechat"
              aria-label="微信登录"
              onClick={() => message.info('微信登录为演示占位')}
            >
              <WechatOutlined />
            </button>
            <button
              type="button"
              className="sm-social-btn sm-social-btn--github"
              aria-label="GitHub 登录"
              onClick={() => message.info('GitHub 登录为演示占位')}
            >
              <GithubOutlined />
            </button>
            <button
              type="button"
              className="sm-social-btn sm-social-btn--alipay"
              aria-label="支付宝登录"
              onClick={() => message.info('支付宝登录为演示占位')}
            >
              <AlipayOutlined />
            </button>
          </div>

          <div className="sm-login-register">
            还没有账号？
            <a
              style={{ color: '#c4470a', fontWeight: 600, marginLeft: 6, textDecoration: 'underline', textUnderlineOffset: 3 }}
              onClick={() => message.info('注册为演示占位')}
            >
              立即注册
            </a>
          </div>

          {/* 演示账号：采购员与管理者角色不同，提交采购单的审批流也不同 */}
          <div
            style={{
              marginTop: 14,
              textAlign: 'center',
              fontSize: 12,
              lineHeight: 1.8,
              color: '#a2968a',
            }}
          >
            演示账号 · 管理者 <b>gm / 123456</b> · 采购员 <b>sales01 / 123456</b>
          </div>


        </div>
      </section>
    </div>
  );
}




