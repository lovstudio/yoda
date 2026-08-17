import { describe, expect, it } from 'vitest';
import {
  buildMobileSessionInteractionAnswer,
  resolveMobileSessionInteraction,
} from './mobile-session-interaction.js';

const awaitingDetail = {
  runtimeStatus: 'awaiting-input' as const,
  runtimeId: 'claude',
};

describe('mobile session interactions', () => {
  it('normalizes provider questions into mobile choices and answers', () => {
    const interaction = resolveMobileSessionInteraction({
      ...awaitingDetail,
      transcript: [
        {
          id: 'question-tool',
          role: 'tool',
          title: 'Tool · AskUserQuestion',
          toolStatus: 'running',
          timestamp: null,
          format: 'code',
          content: JSON.stringify({
            questions: [
              {
                id: 'scope',
                header: '范围',
                question: '选择要处理的范围',
                multiSelect: true,
                options: [
                  { label: '前端', description: '移动端界面', value: 'frontend' },
                  { label: '网关', value: 'gateway' },
                ],
              },
            ],
          }),
        },
      ],
    });

    expect(interaction).toEqual({
      id: 'interaction:question-tool',
      kind: 'choice',
      title: '需要你的选择',
      source: 'claude',
      questions: [
        {
          id: 'scope',
          header: '范围',
          prompt: '选择要处理的范围',
          multiSelect: true,
          options: [
            { id: 'option-1', label: '前端', value: 'frontend', description: '移动端界面' },
            { id: 'option-2', label: '网关', value: 'gateway' },
          ],
        },
      ],
    });
    expect(
      buildMobileSessionInteractionAnswer(interaction!, { scope: ['frontend', 'gateway'] })
    ).toBe('frontend, gateway');
  });

  it('turns plan approval into a Yes/No response', () => {
    const interaction = resolveMobileSessionInteraction({
      ...awaitingDetail,
      transcript: [
        {
          id: 'plan-tool',
          role: 'tool',
          title: 'Tool · ExitPlanMode',
          toolStatus: 'running',
          timestamp: null,
          format: 'code',
          content: JSON.stringify({ plan: '先更新移动端，再补充真机验证。' }),
        },
      ],
    });

    expect(interaction?.kind).toBe('confirmation');
    expect(interaction?.description).toBe('先更新移动端，再补充真机验证。');
    expect(interaction?.questions[0]?.options.map((option) => option.value)).toEqual(['yes', 'no']);
  });

  it('recognizes terminal Yes/No and numbered prompts', () => {
    const confirmation = resolveMobileSessionInteraction({
      ...awaitingDetail,
      runtimeId: 'terminal',
      content: 'Continue with the change? [y/n]',
      transcript: [],
    });
    expect(confirmation?.questions[0]?.prompt).toBe('Continue with the change?');

    const choice = resolveMobileSessionInteraction({
      ...awaitingDetail,
      runtimeId: 'terminal',
      content: '选择环境\n1. 测试\n2. 生产',
      transcript: [],
    });
    expect(choice?.questions[0]?.options.map((option) => option.value)).toEqual(['1', '2']);
  });

  it('keeps a freeform response available when the provider exposes no schema', () => {
    const interaction = resolveMobileSessionInteraction({
      ...awaitingDetail,
      transcript: [],
    });
    expect(interaction).toMatchObject({
      kind: 'text',
      title: '需要你的回应',
      questions: [{ id: 'freeform-response', options: [] }],
    });
  });
});
