import React, { useMemo, useState } from 'react';
import { App, Button, DatePicker, Descriptions, Divider, InputNumber, Modal, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AiReply, PurchaseDraftPayload } from '@/types';
import { confirmDraft } from '@/mock/agent';
import { fmtMoney } from '@/utils/format';

interface Props {
  reply: AiReply;
  onCreated?: (code: string) => void;
}

/**
 * AI 回复统一渲染：结论 / 数据依据 / 原因分析 / 建议动作 / 可执行操作
 * 草稿一律用「确认卡片」呈现，必须人工确认后才创建。
 */
export default function AiReplyView({ reply, onCreated }: Props) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<PurchaseDraftPayload | undefined>(reply.draft);
  const [created, setCreated] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<PurchaseDraftPayload | undefined>();
  const [submitting, setSubmitting] = useState(false);
  /** 分析依据（数据/原因/工具调用）默认收起：先给结论，想看细节再展开 */
  const [showDetail, setShowDetail] = useState(false);
  const hasDetail = reply.evidence.length > 0 || Boolean(reply.cause) || reply.toolCalls.length > 0;

  const total = useMemo(
    () => (draft ? draft.items.reduce((s, i) => s + i.qty * i.price, 0) : 0),
    [draft],
  );

  const handleConfirm = async () => {
    if (!draft) return;
    setSubmitting(true);
    try {
      const po = await confirmDraft({ ...draft, totalAmount: total }, reply.taskId);
      setCreated(po.code);
      message.success(`已创建采购草稿 ${po.code}，请到采购订单中提交审批`);
      onCreated?.(po.code);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = () => {
    setEditDraft(draft ? JSON.parse(JSON.stringify(draft)) : undefined);
    setEditing(true);
  };

  return (
    <div>
      <div className="sm-ai-conclusion">{reply.conclusion}</div>

      {hasDetail && (
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            margin: '4px 0 2px',
            color: '#c4470a',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          {showDetail ? '收起分析依据' : '查看分析依据'}
        </button>
      )}

      {reply.citations && reply.citations.length > 0 && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">引用来源</div>
          <div className="sm-ai-evidence">
            {reply.citations.map((c, idx) => (
              <Tag key={idx} color="orange" style={{ fontSize: 12, marginBottom: 4 }}>
                《{c.title}》{c.section ? ` · ${c.section}` : ''}
                {typeof c.score === 'number' ? ` · ${Math.round(c.score * 100)}%` : ''}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {showDetail && reply.evidence.length > 0 && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">数据依据</div>
          <div className="sm-ai-evidence">
            {reply.evidence.map((e, idx) => (
              <div className="sm-ai-evidence-item" key={idx}>
                {e.label}：<b>{e.value}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDetail && reply.cause && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">原因分析</div>
          <div style={{ fontSize: 13.5, color: '#4a5160', lineHeight: 1.75 }}>{reply.cause}</div>
        </div>
      )}

      {reply.actions.length > 0 && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">建议动作</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: '#4a5160', lineHeight: 1.9 }}>
            {reply.actions.map((a, idx) => (
              <li key={idx}>{a}</li>
            ))}
          </ol>
        </div>
      )}

      {draft && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">
            <ThunderboltOutlined /> 可执行操作 · 采购草稿确认
          </div>
          <div
            style={{
              border: '1px solid #dfe6ff',
              background: '#f7f9ff',
              borderRadius: 8,
              padding: '12px 14px',
            }}
          >
            <Descriptions size="small" column={1} colon={false} styles={{ label: { width: 88, color: '#8a919f' } }}>
              <Descriptions.Item label="业务对象">
                <Tag color="blue">采购订单草稿</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="供应商">{draft.supplierName}</Descriptions.Item>
              <Descriptions.Item label="商品明细">
                {draft.items.map((i) => (
                  <div key={i.productId}>
                    {i.productName}（{i.spec}）
                    <span className="sm-muted">
                      {' '}
                      × {i.qty} {i.unit} @ {fmtMoney(i.price)}
                    </span>
                  </div>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="预计金额">
                <b>{fmtMoney(total)}</b>
              </Descriptions.Item>
              <Descriptions.Item label="预计到货">{draft.expectedArrival.slice(0, 10)}</Descriptions.Item>
              <Descriptions.Item label="计算口径">
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: '#5a6272' }}>
                  {draft.basis.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              </Descriptions.Item>
            </Descriptions>

            {created ? (
              <Space>
                <Tag color="green" icon={<CheckOutlined />}>
                  已创建 {created}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  草稿不会自动审批，需在采购订单中提交
                </Typography.Text>
              </Space>
            ) : (
              <Space style={{ marginTop: 4 }}>
                <Button size="small" icon={<EditOutlined />} onClick={openEdit}>
                  修改
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={submitting}
                  onClick={handleConfirm}
                >
                  确认创建
                </Button>
                <Button size="small" icon={<CloseOutlined />} onClick={() => setDraft(undefined)}>
                  取消
                </Button>
              </Space>
            )}
          </div>
        </div>
      )}

      {showDetail && reply.toolCalls.length > 0 && (
        <div className="sm-ai-section">
          <div className="sm-ai-section-title">工具调用</div>
          <div className="sm-ai-tools">
            {reply.toolCalls.map((c, idx) => (
              <Tag key={idx} color={c.status === 'success' ? 'default' : 'red'} style={{ fontSize: 11.5 }}>
                <span className="sm-mono">{c.name}</span> · {c.durationMs}ms
              </Tag>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={editing}
        title="修改采购草稿"
        okText="保存修改"
        cancelText="放弃"
        onCancel={() => setEditing(false)}
        onOk={() => {
          if (editDraft) setDraft(editDraft);
          setEditing(false);
        }}
      >
        {editDraft && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <div className="sm-muted" style={{ marginBottom: 6 }}>
                供应商：{editDraft.supplierName}
              </div>
              {editDraft.items.map((item, idx) => (
                <Space key={item.productId} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>
                    {item.productName}（{item.spec}）· {item.unit}
                  </span>
                  <InputNumber
                    min={1}
                    value={item.qty}
                    onChange={(v) => {
                      const next = JSON.parse(JSON.stringify(editDraft)) as PurchaseDraftPayload;
                      next.items[idx].qty = Number(v ?? 1);
                      next.totalAmount = next.items.reduce((s, i) => s + i.qty * i.price, 0);
                      setEditDraft(next);
                    }}
                    addonAfter={item.unit}
                  />
                </Space>
              ))}
            </div>
            <div>
              <div className="sm-muted" style={{ marginBottom: 6 }}>
                预计到货日期
              </div>
              <DatePicker
                style={{ width: '100%' }}
                value={dayjs(editDraft.expectedArrival)}
                onChange={(d) =>
                  setEditDraft({ ...editDraft, expectedArrival: d?.toISOString() ?? editDraft.expectedArrival })
                }
              />
            </div>
            <Divider style={{ margin: 0 }} />
            <div style={{ textAlign: 'right' }}>
              预计金额：
              <b>{fmtMoney(editDraft.items.reduce((s, i) => s + i.qty * i.price, 0))}</b>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}

export function AiThinking() {
  return (
    <div className="sm-ai-msg">
      <div className="sm-ai-avatar">
        <RobotOutlined />
      </div>
      <div className="sm-ai-bubble">
        <Space size={6}>
          <Typography.Text type="secondary">Agent 正在调用工具…</Typography.Text>
        </Space>
      </div>
    </div>
  );
}
