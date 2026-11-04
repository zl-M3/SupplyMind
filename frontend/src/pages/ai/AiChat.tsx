import React, { useEffect, useRef, useState } from 'react';
import { App, Badge, Button, Card, Col, Empty, Input, Row, Space, Spin, Tag, Typography } from 'antd';
import { DatabaseOutlined, DislikeOutlined, LikeOutlined, MessageOutlined, PlusOutlined, RobotOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AiMessage } from '@/types';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { AI_TABS } from './tabs';
import AiReplyView from '@/components/AiReplyView';
import MarkdownText from '@/components/MarkdownText';
import { aiApi, AI_CHAT_MODE, feedbackApi } from '@/services/api';
import { useRequest } from '@/hooks/useRequest';
import { fromNow } from '@/utils/format';

const QUICK = [
  '哪些商品库存不足？',
  'P007 需要补多少货？',
  '有哪些采购订单还没到货？',
  '哪些物流延迟了？',
  '采购审批有什么规定？',
];

export default function AiChat() {
  const { message } = App.useApp();
  const { data: convs, reload: reloadConvs } = useRequest(() => aiApi.list(), []);
  const [activeId, setActiveId] = useState<string>();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [voted, setVoted] = useState<Record<string, number>>({});

  const vote = async (messageId: string, score: number) => {
    if (voted[messageId]) return;
    try {
      await feedbackApi.submit(messageId, score);
      setVoted((prev) => ({ ...prev, [messageId]: score }));
      message.success(score > 0 ? '已记录：有帮助' : '已记录：需要改进');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '反馈失败');
    }
  };
  const [detailLoading, setDetailLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 首次进入自动打开最近一次会话，之后点「新对话」不再自动跳回 */
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (convs && convs.length > 0) {
      autoSelectedRef.current = true;
      setActiveId(convs[0].id);
    }
  }, [convs]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    aiApi
      .get(activeId)
      .then((conv) => {
        if (!cancelled) setMessages(conv.messages);
      })
      .catch((e) => {
        if (!cancelled) {
          setMessages([
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: e instanceof Error ? `加载历史消息失败：${e.message}` : '加载历史消息失败',
              at: new Date().toISOString(),
            },
          ]);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: q, at: new Date().toISOString() },
    ]);
    setLoading(true);
    setStreamText('');
    const fail = (message: string) => {
      setStreamText('');
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: message,
          at: new Date().toISOString(),
        },
      ]);
    };
    try {
      await aiApi.chatStream(
        { content: q, conversationId: activeId },
        {
          onDelta: (delta) => setStreamText((prev) => prev + delta),
          onDone: async (conversationId) => {
            setActiveId(conversationId);
            try {
              const conv = await aiApi.get(conversationId);
              setMessages(conv.messages);
            } finally {
              setStreamText('');
              setLoading(false);
              reloadConvs();
            }
          },
          onError: (message) => fail(`调用失败：${message}`),
        },
      );
    } catch (e) {
      fail(e instanceof Error ? `调用失败：${e.message}` : '调用失败');
    }
  };

  const newConversation = () => {
    setActiveId(undefined);
    setMessages([]);
    setInput('');
  };

  return (
    <>
      <PageHeader
        title="AI 对话"
        description="与已接入的 AI 助理对话；历史消息写入数据库，刷新页面或换浏览器都能接着聊"
        extra={
          <Space>
            <Tag color={AI_CHAT_MODE === 'real' ? 'green' : 'orange'} icon={<DatabaseOutlined />}>
              {AI_CHAT_MODE === 'real' ? '历史已入库' : '演示数据'}
            </Tag>
            <Button icon={<PlusOutlined />} onClick={newConversation} disabled={loading}>
              新对话
            </Button>
          </Space>
        }
      />

      <ModuleTabs items={AI_TABS} />

      <Row gutter={16}>
        <Col xs={24} lg={7} xl={6}>
          <Card
            size="small"
            title={
              <Space>
                <MessageOutlined />
                会话记录
                <Badge count={convs?.length ?? 0} size="small" color="#2f54eb" />
              </Space>
            }
            styles={{ body: { padding: 8, maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' } }}
          >
            {(convs ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有会话，问一句试试" />
            ) : (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {(convs ?? []).map((c) => (
                  <div
                    key={c.id}
                    className={`sm-chat-list-item ${c.id === activeId ? 'sm-chat-list-item--active' : ''}`}
                    onClick={() => {
                      if (!loading) setActiveId(c.id);
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: c.id === activeId ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.title}
                    </div>
                    <div className="sm-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {c.messageCount} 条消息 · {fromNow(c.updatedAt)}
                    </div>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          <Card
            size="small"
            styles={{ body: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' } }}
          >
            <div className="sm-chat-body" ref={bodyRef} style={{ height: 'auto', flex: 1 }}>
              {detailLoading && messages.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
                  <Spin />
                </div>
              ) : messages.length === 0 && !loading ? (
                <div style={{ paddingTop: 40 }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <div>
                        <div style={{ marginBottom: 10 }}>试着问一句：库存预警 → 补货建议 → 采购草稿</div>
                        <Space wrap>
                          {QUICK.map((q) => (
                            <Tag key={q} style={{ cursor: 'pointer' }} onClick={() => void send(q)}>
                              {q}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    }
                  />
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`sm-ai-msg ${m.role === 'user' ? 'sm-ai-msg--user' : ''}`}>
                    <div className="sm-ai-avatar">
                      {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    </div>
                    <div className="sm-ai-bubble">
                      {m.role === 'user' ? m.content : m.reply ? <AiReplyView reply={m.reply} /> : m.content}
                      <div style={{ marginTop: 6, fontSize: 11, color: '#b0b6c1', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{dayjs(m.at).format('MM-DD HH:mm')}</span>
                        {m.role === 'assistant' && (
                          <>
                            <Button
                              size="small"
                              type="text"
                              aria-label="回答有帮助"
                              icon={<LikeOutlined />}
                              style={{ color: voted[m.id] === 1 ? '#f26522' : '#b0b6c1' }}
                              onClick={() => void vote(m.id, 1)}
                            />
                            <Button
                              size="small"
                              type="text"
                              aria-label="回答需改进"
                              icon={<DislikeOutlined />}
                              style={{ color: voted[m.id] === -1 ? '#dc2626' : '#b0b6c1' }}
                              onClick={() => void vote(m.id, -1)}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {loading && streamText && (
                <div className="sm-ai-msg">
                  <div className="sm-ai-avatar">
                    <RobotOutlined />
                  </div>
                  <div className="sm-ai-bubble">
                    <MarkdownText text={streamText} />
                  </div>
                </div>
              )}
              {loading && !streamText && (
                <div className="sm-ai-msg">
                  <div className="sm-ai-avatar">
                    <RobotOutlined />
                  </div>
                  <div className="sm-ai-bubble">
                    <Spin size="small" /> <span className="sm-muted">AI 助理正在分析并调用工具…</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
                {QUICK.slice(0, 3).map((q) => (
                  <Tag key={q} style={{ cursor: 'pointer' }} onClick={() => void send(q)}>
                    {q}
                  </Tag>
                ))}
              </Space>
              <Space.Compact style={{ width: '100%' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="输入问题，Shift + Enter 换行"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                />
                <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void send(input)}>
                  发送
                </Button>
              </Space.Compact>
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                回复结构：结论 / 数据依据 / 原因分析 / 建议动作 / 可执行操作；对话记录保存在 ai_conversations、ai_messages 表
              </Typography.Text>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
