import { describe, expect, it } from 'vitest';
import {
  buildSummaryDraft,
  normalizeGeneratedSummaryText,
  type SummaryPromptRuntime,
} from './session-summary-prompt';

const runtime: SummaryPromptRuntime = {
  systemPrompt: '',
  language: 'zh-CN',
  context: { user: true, assistant: true, project: false },
};

describe('session delivery summary generation', () => {
  it('builds an incremental global prompt from the previous summary and new messages', () => {
    const draft = buildSummaryDraft(
      runtime,
      '/repo',
      [{ id: 'message-1', role: 'assistant', text: '新增了自动刷新服务。', timestamp: null }],
      'global',
      '已完成摘要生成基础能力。'
    );

    expect(draft?.previousSummary).toBe('已完成摘要生成基础能力。');
    expect(draft?.prompt).toContain('Existing summary:\n已完成摘要生成基础能力。');
    expect(draft?.prompt).toContain('New transcript messages since the existing summary');
    expect(draft?.prompt).toContain('ASSISTANT: 新增了自动刷新服务。');
  });

  it('normalizes recent output to one plain sentence', () => {
    expect(
      normalizeGeneratedSummaryText('```text\n- 已完成自动刷新。后续补测试。\n```', 'recent')
    ).toBe('已完成自动刷新。');
  });

  it('clips global output at a readable boundary', () => {
    const value = `${'甲'.repeat(500)}。${'乙'.repeat(500)}`;
    const normalized = normalizeGeneratedSummaryText(value, 'global');

    expect(normalized.length).toBeLessThanOrEqual(800);
    expect(normalized.endsWith('。')).toBe(true);
  });
});
