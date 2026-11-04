import React, { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Empty, Input, Space, Spin, Tag } from 'antd';
import { RobotOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import type { AiMessage, AiPageContext } from '@/types';
import { askAgent } from '@/mock/agent';
import AiReplyView from '@/components/AiReplyView';

interface Props {
  open: boolean;
  context?: AiPageContext;
  presetQuestion?: string;
  onClose: () => void;
}

const QUICK_QUESTIONS = [
  '哪些商品库存不足？',
  '有哪些物流延迟了？',
  '哪些采购订单还没到货？',
  '采购审批有什么规定？',
];

export default function AiDrawer({ open, context, presetQuestion, onClose }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const convRef = useRef<string>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: question, at: new Date().toISOString() },
    ]);
    setLoading(true);
    try {
      const res = await askAgent(question, context, convRef.current);
      convRef.current = res.conversationId;
      setMessages((prev) => [
        ...prev,
        {
          id: res.messageId,
          role: 'assistant',
          content: res.reply.conclusion,
          at: new Date().toISOString(),
          reply: res.reply,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: e instanceof Error ? `调用失败：${e.message}` : '调用失败',
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    if (presetQuestion) void send(presetQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined style={{ color: '#2f54eb' }} />
          <span>  助手</span>
          <Tag color="blue" style={{ marginLeft: 4 }}>
            Agent
          </Tag>
        </Space>
      }
      width={540}
      open={open}
      onClose={onClose}
      styles={{ body: { display: 'flex', flexDirection: 'column', padding: 16 } }}
      footer={
        <div>
          <div style={{ marginBottom: 8 }}>
            <Space wrap size={[6, 6]}>
              {QUICK_QUESTIONS.map((q) => (
                <Tag
                  key={q}
                  style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                  onClick={() => void send(q)}
                >
                  {q}
                </Tag>
              ))}
            </Space>
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问库存、采购、供应商、物流，或让它算补货量"
              autoSize={{ minRows: 1, maxRows: 3 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => void send(input)} loading={loading} />
          </Space.Compact>
        </div>
      }
    >
      {context && (
        <div style={{ marginBottom: 12 }}>
          <span className="sm-ai-context-chip">
            当前上下文：{context.pageName}
            {context.targetName ? ` · ${context.targetName}` : ''}
          </span>
        </div>
      )}

      <div className="sm-chat-body" ref={bodyRef} style={{ height: 'auto', flex: 1 }}>
        {messages.length === 0 && !loading && (
          <div style={{ paddingTop: 40 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div>
                  <div>可以问我：库存缺口、采购进度、供应商履约、物流延迟</div>
                  <div className="sm-muted" style={{ fontSize: 12, marginTop: 6 }}>
                    AI 只会生成采购草稿，审批与收货仍需你在业务页面操作
                  </div>
                </div>
              }
            />
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`sm-ai-msg ${m.role === 'user' ? 'sm-ai-msg--user' : ''}`}>
            <div className="sm-ai-avatar">{m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}</div>
            <div className="sm-ai-bubble">
              {m.role === 'user' ? (
                m.content
              ) : m.reply ? (
                <AiReplyView reply={m.reply} />
              ) : (
                m.content
              )}
              <div style={{ marginTop: 6, fontSize: 11, color: '#b0b6c1' }}>{dayjs(m.at).format('HH:mm')}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="sm-ai-msg">
            <div className="sm-ai-avatar">
              <RobotOutlined />
            </div>
            <div className="sm-ai-bubble">
              <Spin size="small" /> <span className="sm-muted">Agent 正在调用工具…</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8, marginTop: 8 }}>
        <Button type="link" size="small" style={{ paddingLeft: 0 }} onClick={() => navigate('/ai/chat')}>
          打开完整对话页 →
        </Button>
      </div>
    </Drawer>
  );
}
