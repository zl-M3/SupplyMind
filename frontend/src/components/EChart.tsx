import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

interface Props {
  option: EChartsOption;
  height?: number | string;
}

/**
 * ECharts 轻封装（不额外引入 echarts-for-react，少一个依赖）
 * 注意：容器必须有明确高度，否则图不显示。
 */
export default function EChart({ option, height = 240 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts>();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
