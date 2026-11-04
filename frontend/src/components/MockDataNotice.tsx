import { Alert } from 'antd';
import { API_MODE } from '@/services/api';

/**
 * 「本页还没接数据库」提示。
 *
 * AI 智能中心（对话 / 任务 / 报告）目前仍读前端 mock（localStorage），
 * 而采购、库存、工作台等页面已经全部走后端 + MySQL。
 * 真实后端模式下必须把这件事说清楚，否则很容易被当成
 * 「页面没有同步数据库」——但实际上是这些页面本来就没接库。
 */
export default function MockDataNotice({ scope }: { scope: string }) {
  if (API_MODE !== 'real') return null;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message={`${scope}目前仍使用浏览器本地的演示数据，未接入后端 /ai/* 接口`}
      description="工作台、供应商、采购订单、商品与库存等页面已经全部读取数据库；AI 智能中心的会话 / 任务 / 报告仍是前端 mock（localStorage），所以这里看到的内容不会与库中的 ai_tasks、ai_reports 保持一致。"
    />
  );
}
