/**
 * 「AI 今日洞察」的提示词组装
 *
 * 思路：不只是把问题丢给 AI，而是先把**当前库里的实时数据**拼进去
 * （待审批采购单 + 物流异常），这样 Dify 拿到的是"今日快照"，
 * 回答才有具体单号、金额和延迟天数，而不是空泛建议。
 */

import dayjs from 'dayjs';
import { logisticsApi, purchaseOrderApi } from '@/services/api';
import { fmtAmount, fmtDate } from '@/utils/format';

export async function buildDailyInsightPrompt(): Promise<string> {
  const [pending, delayed] = await Promise.all([
    purchaseOrderApi.list({ status: 'pending', page: 1, pageSize: 20 }),
    logisticsApi.list({ onlyDelayed: true, page: 1, pageSize: 20 }),
  ]);

  const lines: string[] = [];
  lines.push(`请基于下面的实时数据，输出今天的「供应链今日洞察」。今天是 ${dayjs().format('YYYY年MM月DD日')}。`);

  lines.push('');
  lines.push(`【一、待审批采购订单】共 ${pending.total} 单`);
  if (!pending.list.length) {
    lines.push('暂无待审批采购订单。');
  } else {
    pending.list.slice(0, 10).forEach((po, idx) => {
      const hours = Math.max(0, dayjs().diff(dayjs(po.createdAt), 'hour'));
      lines.push(
        `${idx + 1}. ${po.code}｜${po.supplierName}｜${fmtAmount(po.totalAmount)}｜创建人 ${po.createdByName}` +
          `｜预计到货 ${fmtDate(po.expectedArrival)}｜已等待 ${hours} 小时`,
      );
    });
    if (pending.total > 10) lines.push(`（仅列出前 10 单，共 ${pending.total} 单）`);
  }

  lines.push('');
  lines.push(`【二、物流异常】超过预计到达时间仍未签收，共 ${delayed.total} 单`);
  if (!delayed.list.length) {
    lines.push('暂无物流异常。');
  } else {
    delayed.list.slice(0, 10).forEach((lo, idx) => {
      const late = Math.max(0, dayjs().diff(dayjs(lo.expectedArrival), 'day'));
      lines.push(
        `${idx + 1}. ${lo.code}｜采购单 ${lo.poCode}｜${lo.carrier}｜运单 ${lo.trackingNo}` +
          `｜预计到达 ${fmtDate(lo.expectedArrival)}｜已延迟 ${late} 天｜当前状态 ${lo.status}`,
      );
    });
    if (delayed.total > 10) lines.push(`（仅列出前 10 单，共 ${delayed.total} 单）`);
  }

  lines.push('');
  lines.push('请按下面三段输出，不要罗列原始数据：');
  lines.push('1）结论：一句话说清今天最该先处理什么；');
  lines.push('2）风险与原因：结合具体单号/供应商/金额/延迟天数，说明为什么优先；');
  lines.push('3）建议动作：3 条可执行动作，写清「谁 + 做什么 + 什么时候」。');

  return lines.join('\n');
}

/** 数据取不到时的兜底提问 */
export const DAILY_INSIGHT_FALLBACK = '请分析今天的待审批采购订单和物流异常，给出优先级与建议动作。';
