import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTranscriptMessage } from '@shared/conversations';

const mocks = vi.hoisted(() => ({
  runAgentCli: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock('@main/core/agent-cli/run-agent-cli', () => ({
  extractAgentMessageText: (value: string) => value.trim(),
  runAgentCli: mocks.runAgentCli,
}));

vi.mock('@main/core/agents-config/builtin-agent-resolver', () => ({
  resolveSelectedUtilityAgent: vi.fn(),
}));

vi.mock('@main/core/projects/settings/composer-default-overrides', () => ({
  getProjectComposerDefaults: vi.fn(),
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

describe('generateSessionSummary CLI failures', () => {
  beforeEach(() => {
    mocks.runAgentCli.mockReset();
    mocks.getRuntimeConfig.mockReset().mockResolvedValue(undefined);
  });

  it('returns the provider error instead of reducing it to an empty result', async () => {
    const providerError =
      'Claude Code command failed: Your organization has disabled Claude subscription access.';
    mocks.runAgentCli.mockRejectedValue(new Error(providerError));
    const { generateSessionSummary } = await import('./generateSessionSummary');
    const { buildSummaryDraft } = await import('./session-summary-prompt');
    const messages: SessionTranscriptMessage[] = [
      { id: 'message-1', role: 'user', text: '生成交付摘要。', timestamp: null },
    ];
    const runtime = {
      runtimeId: 'claude' as const,
      runtimeName: 'Claude Code',
      model: 'claude-haiku-4-5',
      systemPrompt: 'Summarize faithfully.',
      language: 'zh-CN' as const,
      context: { user: true, assistant: true, project: false },
    };
    const draft = buildSummaryDraft(runtime, '/repo', messages, 'global');
    if (!draft) throw new Error('Expected a summary draft');

    await expect(generateSessionSummary(runtime, '/repo', draft, 'global')).resolves.toEqual({
      summary: null,
      error: providerError,
    });
  });
});
