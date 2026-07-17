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

  it('compacts injected skill definitions to invocation markers', () => {
    const draft = buildSummaryDraft(
      runtime,
      '/repo',
      [
        {
          id: 'message-1',
          role: 'user',
          text: '实现自动更新的交付摘要。',
          timestamp: null,
        },
        {
          id: 'message-2',
          role: 'user',
          text: `<skill>
<name>lovstudio-release-via-cicd</name>
<path>/tmp/release/SKILL.md</path>
---
# Release via CI/CD
Run a long release workflow.
</skill>`,
          timestamp: null,
        },
      ],
      'global'
    );

    expect(draft?.transcript).toContain('[Skill invoked: $lovstudio-release-via-cicd]');
    expect(draft?.transcript).not.toContain('Run a long release workflow.');
    expect(draft?.prompt).not.toContain('/tmp/release/SKILL.md');
  });

  it('keeps the initial goal and latest progress when the transcript is too long', () => {
    const messages = [
      { id: 'goal', role: 'user' as const, text: '保留最初用户目标。', timestamp: null },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `middle-${index}`,
        role: 'assistant' as const,
        text: `中间过程 ${index} ${'甲'.repeat(1_500)}`,
        timestamp: null,
      })),
      {
        id: 'latest',
        role: 'assistant' as const,
        text: '最新进展：实现、测试并完成发布。',
        timestamp: null,
      },
    ];
    const draft = buildSummaryDraft(runtime, '/repo', messages, 'global');

    expect(draft?.transcriptTruncated).toBe(true);
    expect(draft?.transcript).toContain('保留最初用户目标。');
    expect(draft?.transcript).toContain('最新进展：实现、测试并完成发布。');
    expect(draft?.transcript).toContain('omitted for length');
    expect(draft?.transcript.length).toBeLessThanOrEqual(8_000);
  });

  it('clips global output at a readable boundary', () => {
    const value = `${'甲'.repeat(500)}。${'乙'.repeat(500)}`;
    const normalized = normalizeGeneratedSummaryText(value, 'global');

    expect(normalized.length).toBeLessThanOrEqual(800);
    expect(normalized.endsWith('。')).toBe(true);
  });
});
