import type { ModuleTabItem } from '@/components/ModuleTabs';

/** AI 智能中心的二级导航 */
export const AI_TABS: ModuleTabItem[] = [
  { key: 'chat', label: 'AI 对话', to: '/ai/chat' },
  { key: 'tasks', label: 'Agent 任务中心', to: '/ai/tasks', disabled: true, disabledTip: '开发中' },
  { key: 'reports', label: 'AI 分析报告', to: '/ai/reports', disabled: true, disabledTip: '开发中' },
  { key: 'knowledge', label: '知识库', to: '/ai/knowledge' },
];
