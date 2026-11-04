import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, DatePicker, Empty, Row, Skeleton, Space, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  AlertOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  InboxOutlined,
  RobotOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import EChart from '@/components/EChart';
import StatCard from '@/components/StatCard';
import { BlurFade } from '@/components/magic/Motion';
import { RobotMascot, HeroGlow } from '@/components/Artwork';
import { ShimmerButton } from '@/components/magic/ShimmerButton';
import { dashboardApi } from '@/services/api';
import type { DashboardCharts } from '@/services/realApi';
import { openAiAssistant } from '@/services/aiAssistant';
import { buildDailyInsightPrompt, DAILY_INSIGHT_FALLBACK } from '@/services/dailyInsight';
import { useRequest } from '@/hooks/useRequest';
import { fmtAmount, fmtDate, fromNow } from '@/utils/format';

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading } = useRequest(() => dashboardApi.summary(), []);
  const [insightLoading, setInsightLoading] = useState(false);
  const [trendPoints, setTrendPoints] = useState(data?.trend ?? []);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day'), dayjs()]);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    if (data?.trend) setTrendPoints(data.trend);
  }, [data]);

  useEffect(() => {
    dashboardApi
      .charts()
      .then(setCharts)
      .catch(() => undefined);
  }, []);

  const onRangeChange = async (value: any) => {
    if (!value?.[0] || !value?.[1]) return;
    const [start, end] = value as [Dayjs, Dayjs];
    setRange([start, end]);
    const days = end.diff(start, 'day') + 1;
    setTrendLoading(true);
    try {
      const points = await dashboardApi.trend(
        days,
        start.format('YYYY-MM-DD'),
        end.format('YYYY-MM-DD'),
      );
      setTrendPoints(points);
    } finally {
      setTrendLoading(false);
    }
  };

  /**
   * AI 今日洞察：先把「待审批采购单 + 物流异常」的实时数据汇总成一段提示词，
   * 再唤起右下角的 Dify 助手并自动发送，助手会直接给出今日洞察结论。
   */
  const openDailyInsight = async () => {
    setInsightLoading(true);
    try {
      const prompt = await buildDailyInsightPrompt();
      openAiAssistant(prompt, true);
    } catch {
      openAiAssistant(DAILY_INSIGHT_FALLBACK, true);
    } finally {
      setInsightLoading(false);
    }
  };

  const chartOption = useMemo<EChartsOption>(() => {
    const trend = trendPoints;
    return {
      grid: { left: 4, right: 14, top: 22, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(31,27,22,.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const item = trend[p.dataIndex];
          if (!item) return '';
          return `${item.date}<br/>采购金额 ${fmtAmount(item.amount)}<br/>订单 ${item.count} 单`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trend.map((t) => t.date),
        axisLine: { lineStyle: { color: '#f2e5d8' } },
        axisLabel: { color: '#b3a89a', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#faf2ea' } },
        axisLabel: {
          color: '#b3a89a',
          fontSize: 11,
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)),
        },
      },
      series: [
        {
          name: '采购金额',
          type: 'line',
          smooth: 0.4,
          showSymbol: false,
          symbolSize: 7,
          data: trend.map((t) => t.amount),
          itemStyle: { color: '#f26522' },
          lineStyle: { width: 2.6, color: '#f26522' },
          emphasis: { itemStyle: { color: '#f26522', borderColor: '#fff', borderWidth: 2 } },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(242,101,34,0.26)' },
                { offset: 1, color: 'rgba(242,101,34,0.01)' },
              ],
            },
          },
        },
      ],
    };
  }, [trendPoints]);

  const inventoryPieOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 11, color: '#8a8175' } },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { fontSize: 11, color: '#6b6257' },
          data: (charts?.inventoryByCategory ?? []).map((x) => ({ name: x.category, value: x.qty })),
        },
      ],
    }),
    [charts],
  );

  const supplierBarOption = useMemo<EChartsOption>(() => {
    const rows = (charts?.supplierScores ?? []).slice(0, 6);
    return {
      grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v}%` },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.name.replace(/有限公司|有限责任公司|厂|公司/g, '')),
        axisLabel: { fontSize: 10, interval: 0, rotate: 20, color: '#8a8175' },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#f2e5d8' } },
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLabel: { formatter: '{value}%', fontSize: 10, color: '#b3a89a' },
        splitLine: { lineStyle: { color: '#faf2ea' } },
      },
      series: [
        {
          type: 'bar',
          barWidth: 18,
          itemStyle: { color: '#f26522', borderRadius: [6, 6, 0, 0] },
          data: rows.map((r) => Math.round((r.onTimeRate ?? 0) * 100)),
        },
      ],
    };
  }, [charts]);

  const logisticsPieOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 11, color: '#8a8175' } },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { fontSize: 11, color: '#6b6257' },
          data: (charts?.logisticsStatus ?? []).map((x) => ({ name: x.label, value: x.count })),
        },
      ],
    }),
    [charts],
  );

  if (loading && !data) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Card>
    );
  }

  const kpi = data!.kpi;
  const { todos, alerts, insights } = data!;

  const today = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  const todoItems = [
    ...todos.pendingApproval.slice(0, 2).map((po) => ({
      key: `pa-${po.id}`,
      dot: 'var(--sm-amber)',
      text: `待审批 · ${po.code} ${po.supplierName}`,
      meta: fromNow(po.createdAt),
      onClick: () => navigate(`/purchase/orders/${po.id}`),
    })),
    ...todos.toReceive.slice(0, 2).map((po) => {
      const rest = dayjs(po.expectedArrival).diff(dayjs(), 'day');
      return {
        key: `tr-${po.id}`,
        dot: 'var(--sm-blue)',
        text: `待收货 · ${po.code} 预计 ${fmtDate(po.expectedArrival)}`,
        meta: rest < 0 ? `逾期 ${Math.abs(rest)} 天` : `还剩 ${rest} 天`,
        onClick: () => navigate(`/purchase/orders/${po.id}`),
      };
    }),
    ...todos.logisticsException.slice(0, 2).map((lo) => ({
      key: `le-${lo.id}`,
      dot: 'var(--sm-red)',
      text: `物流异常 · ${lo.code} ${lo.carrier}`,
      meta: fromNow(lo.expectedArrival),
      onClick: () => navigate(`/purchase/logistics/${lo.id}`),
    })),
  ].slice(0, 5);

  const amountTrend =
    kpi.poAmountDelta == null
      ? undefined
      : { dir: kpi.poAmountDelta >= 0 ? ('up' as const) : ('down' as const), text: `${Math.abs(kpi.poAmountDelta * 100).toFixed(1)}%` };

  return (
    <>
      {/* ---------- 问候区 ---------- */}
      <BlurFade>
        <section className="sm-hero">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h1 className="sm-hero-title">
              你好，张伟 <span style={{ fontSize: 20 }}>👋</span>
            </h1>
            <p className="sm-hero-sub" style={{ margin: 0 }}>
              今天是 {today}，祝你工作愉快！
            </p>
            <Space size={8} style={{ marginTop: 14 }} wrap>
              <ShimmerButton icon={<RobotOutlined />} onClick={() => void openDailyInsight()}>
                {insightLoading ? '正在汇总今日数据…' : 'AI 今日洞察'}
              </ShimmerButton>
              <Button onClick={() => navigate('/purchase/orders')}>去采购订单</Button>
            </Space>
          </div>
          <HeroGlow />
        </section>
      </BlurFade>

      {/* ---------- KPI ---------- */}
      <BlurFade delay={60}>
        <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
          <StatCard
            label="采购订单"
            value={kpi.poCount}
            suffix="单"
            icon={<ShoppingCartOutlined />}
            tone="orange"
            hint={kpi.periodLabel ? `${kpi.periodLabel} · 全部状态` : '全部状态'}
            onClick={() => navigate('/purchase/orders')}
          />
          <StatCard
            label="采购金额"
            value={kpi.poAmount}
            prefix="¥"
            icon={<WalletOutlined />}
            tone="green"
            trend={amountTrend}
            hint={amountTrend ? '较前 7 天' : kpi.periodLabel ? `${kpi.periodLabel} · 累计` : '累计'}
            onClick={() => navigate('/purchase/orders')}
          />
          {/*<StatCard*/}
          {/*  label="库存总量"*/}
          {/*  value={kpi.totalStockQty}*/}
          {/*  icon={<DatabaseOutlined />}*/}
          {/*  tone="amber"*/}
          {/*  hint="3 个仓库合计"*/}
          {/*  onClick={() => navigate('/catalog/stock')}*/}
          {/*/>*/}
          {/*<StatCard*/}
          {/*  label="低库存商品"*/}
          {/*  value={kpi.lowStockCount}*/}
          {/*  suffix="个"*/}
          {/*  icon={<WarningOutlined />}*/}
          {/*  tone="red"*/}
          {/*  hint="含缺货商品"*/}
          {/*  onClick={() => navigate('/catalog/alerts')}*/}
          {/*/>*/}
          <StatCard
            label="待审批订单"
            value={kpi.pendingApprovalCount}
            suffix="单"
            icon={<ClockCircleOutlined />}
            tone="blue"
            hint="审批后才能收货"
            onClick={() => navigate('/purchase/orders?status=pending')}
          />
          <StatCard
            label="延迟物流"
            value={kpi.delayedLogisticsCount}
            suffix="单"
            icon={<AlertOutlined />}
            tone="violet"
            hint="超预计到达时间"
            onClick={() => navigate('/purchase/logistics?delayed=1')}
          />
        </div>
      </BlurFade>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <BlurFade delay={120}>
            <Card
              title="采购金额趋势"
              size="small"
              extra={
                <Space size={8}>
                  <DatePicker.RangePicker
                    size="small"
                    value={range}
                    allowClear={false}
                    onChange={onRangeChange}
                    disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    单位：元
                  </Typography.Text>
                </Space>
              }
              loading={trendLoading}
              styles={{ body: { paddingTop: 6 } }}
            >
              <EChart option={chartOption} height={272} />
            </Card>
          </BlurFade>
        </Col>

        <Col xs={24} xl={8}>
          <BlurFade delay={180}>
            <Card
              title="待办事项"
              size="small"
              extra={
                <Button type="link" size="small" onClick={() => navigate('/purchase/orders')}>
                  全部 <ArrowRightOutlined style={{ fontSize: 11 }} />
                </Button>
              }
              styles={{ body: { paddingTop: 4 } }}
            >
              {todoItems.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天没有待处理事项" />
              ) : (
                todoItems.map((item) => (
                  <div key={item.key} className="sm-todo-item" onClick={item.onClick}>
                    <span className="sm-dot" style={{ background: item.dot }} />
                    <span className="sm-todo-text">{item.text}</span>
                    <span className="sm-todo-meta">{item.meta}</span>
                  </div>
                ))
              )}
            </Card>
          </BlurFade>
        </Col>

        <Col xs={24} xl={16}>
          <BlurFade delay={240}>
            <Card title="异常提醒" size="small" extra={<span className="sm-muted" style={{ fontSize: 12 }}>实时规则计算</span>}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {alerts.lowStock.length === 0 && alerts.delayedLogistics.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有异常" />
                ) : (
                  <>
                    {alerts.lowStock.slice(0, 3).map((row) => (
                      <div key={row.productId} className="sm-todo-item" style={{ cursor: 'default' }}>
                        <span
                          className="sm-dot"
                          style={{ background: row.level === 'out' ? 'var(--sm-red)' : 'var(--sm-amber)' }}
                        />
                        <span className="sm-todo-text">
                          {row.productName}
                          <span className="sm-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            {row.totalQty} / 安全 {row.safetyStock} {row.unit}
                          </span>
                        </span>
                        <Tag color={row.level === 'out' ? 'red' : 'orange'} style={{ marginInlineEnd: 0 }}>
                          {row.level === 'out' ? '缺货' : '低库存'}
                        </Tag>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openAiAssistant(`${row.productName} 需要补多少货？`)}
                        >
                          AI 补货
                        </Button>
                      </div>
                    ))}

                    {alerts.delayedLogistics.slice(0, 2).map((lo) => (
                      <div
                        key={lo.id}
                        className="sm-todo-item"
                        onClick={() => navigate(`/purchase/logistics/${lo.id}`)}
                      >
                        <span className="sm-dot" style={{ background: 'var(--sm-red)' }} />
                        <span className="sm-todo-text">
                          {lo.code}
                          <span className="sm-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            {lo.carrier} · 预计 {fmtDate(lo.expectedArrival)}
                          </span>
                        </span>
                        <Tag color="red" style={{ marginInlineEnd: 0 }}>
                          延迟
                        </Tag>
                      </div>
                    ))}
                  </>
                )}
              </Space>
            </Card>
          </BlurFade>
        </Col>

        <Col xs={24} xl={8}>
          <BlurFade delay={300}>
            <div className="sm-insight" style={{ flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <RobotOutlined style={{ color: 'var(--sm-primary)' }} />
                <strong style={{ fontSize: 13.5 }}>AI 今日洞察</strong>
                <span style={{ flex: 1 }} />
                <Button
                  type="link"
                  size="small"
                  onClick={() => openAiAssistant('把今天的洞察结论再展开一些，给出更具体的处理建议。')}
                >
                  追问
                </Button>
              </div>

              {insights.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天没有需要关注的异常" />
              ) : (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {insights.map((text, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span
                        className="sm-dot"
                        style={{ marginTop: 7, background: idx === 0 ? 'var(--sm-red)' : 'var(--sm-amber)' }}
                      />
                      <span className="sm-insight-text">{text}</span>
                    </div>
                  ))}
                </Space>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11.5, lineHeight: 1.6, maxWidth: '72%' }}>
                  结论由 Agent 基于当前业务数据生成，建议动作需人工确认后执行。
                </Typography.Text>
                <RobotMascot size={52} />
              </div>
            </div>
          </BlurFade>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={8}>
          <BlurFade delay={220}>
            <Card title="库存结构（按大类）" size="small" styles={{ body: { paddingTop: 4 } }}>
              {charts && charts.inventoryByCategory.length > 0 ? (
                <EChart option={inventoryPieOption} height={240} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无库存数据" />
              )}
            </Card>
          </BlurFade>
        </Col>
        <Col xs={24} xl={8}>
          <BlurFade delay={260}>
            <Card title="供应商准时交付率" size="small" styles={{ body: { paddingTop: 4 } }}>
              {charts && charts.supplierScores.length > 0 ? (
                <EChart option={supplierBarOption} height={240} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无供应商数据" />
              )}
            </Card>
          </BlurFade>
        </Col>
        <Col xs={24} xl={8}>
          <BlurFade delay={300}>
            <Card title="物流状态分布" size="small" styles={{ body: { paddingTop: 4 } }}>
              {charts && charts.logisticsStatus.length > 0 ? (
                <EChart option={logisticsPieOption} height={240} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物流数据" />
              )}
            </Card>
          </BlurFade>
        </Col>
      </Row>
    </>
  );
}


