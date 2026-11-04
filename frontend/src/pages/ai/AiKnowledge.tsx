import React, { useState } from 'react';
import { App, Button, Card, Col, Empty, Input, List, Modal, Row, Tag, Typography } from 'antd';
import { FileTextOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import ModuleTabs from '@/components/ModuleTabs';
import { AI_TABS } from './tabs';
import { knowledgeApi, type KnowledgeHit } from '@/services/ai';
import { useRequest } from '@/hooks/useRequest';

/**
 * 知识库：AI 回答「制度 / 流程」类问题时的检索来源。
 * 这里可以看文档、加文档，并直接测试检索效果（带相似度分数）。
 */
export default function AiKnowledge() {
  const { message } = App.useApp();
  const { data: docs, loading: docsLoading, reload } = useRequest(() => knowledgeApi.list(), []);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setHits(await knowledgeApi.search(query, 5));
    } catch (e) {
      message.error(e instanceof Error ? e.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!filename.trim() || !content.trim()) {
      message.warning('文件名和正文都要填');
      return;
    }
    setSaving(true);
    try {
      await knowledgeApi.upload(filename, content);
      message.success('已写入知识库');
      setOpen(false);
      setFilename('');
      setContent('');
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="知识库"
        description="AI 回答制度 / 流程类问题时的检索来源；这里可以维护文档并测试检索效果"
      />
      <ModuleTabs items={AI_TABS} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title={`文档（${docs?.length ?? 0}）`}
            extra={
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
                新增文档
              </Button>
            }
            loading={docsLoading}
          >
            {(docs ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有知识文档" />
            ) : (
              <List
                dataSource={docs ?? []}
                renderItem={(doc) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<FileTextOutlined style={{ color: '#f26522', fontSize: 18 }} />}
                      title={doc.title}
                      description={`${doc.section_count} 个小节 · ${doc.chars} 字`}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card size="small" title="检索测试">
            <Input
              allowClear
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => void doSearch()}
              placeholder="例如：采购审批需要什么权限？"
              prefix={<SearchOutlined />}
              suffix={
                <Button type="link" size="small" loading={searching} onClick={() => void doSearch()}>
                  检索
                </Button>
              }
            />
            <div style={{ marginTop: 12 }}>
              {hits.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={query ? '没有命中，换个说法试试' : '输入问题查看命中的制度条款'}
                />
              ) : (
                <List
                  dataSource={hits}
                  renderItem={(hit) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Tag color="orange">《{hit.title}》</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {hit.section}
                          </Typography.Text>
                          <span style={{ flex: 1 }} />
                          <Tag color={hit.score > 0.2 ? 'green' : 'default'}>
                            相似度 {(hit.score * 100).toFixed(0)}%
                          </Tag>
                        </div>
                        <Typography.Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
                          {hit.content}
                        </Typography.Paragraph>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title="新增知识文档"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={720}
        destroyOnClose
      >
        <Input
          style={{ marginBottom: 10 }}
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="文档名，例如：供应商准入规范"
        />
        <Input.TextArea
          rows={14}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'# 标题\n\n## 小节一\n正文……'}
        />
      </Modal>
    </>
  );
}
