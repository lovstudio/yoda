import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileQuickAction } from './quick-action-compiler';

const mocks = vi.hoisted(() => ({
  resolveCommandPath: vi.fn(),
  getRuntimeConfig: vi.fn(),
  runAgentCli: vi.fn(),
}));

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: mocks.resolveCommandPath,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

vi.mock('@main/core/agent-cli/run-agent-cli', () => ({
  extractAgentMessageText: (value: string) => value,
  runAgentCli: mocks.runAgentCli,
}));

vi.mock('@main/utils/childProcessEnv', () => ({
  buildExternalToolEnv: (env: NodeJS.ProcessEnv) => env,
}));

vi.mock('../conversations/impl/runtime-env', () => ({
  resolveRuntimeBaseEnv: (env: NodeJS.ProcessEnv) => env,
  resolveRuntimeEnv: () => ({}),
}));

describe('compileQuickAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCommandPath.mockResolvedValue('/opt/homebrew/bin/codex');
    mocks.getRuntimeConfig.mockResolvedValue({});
    mocks.runAgentCli.mockResolvedValue({
      stdout: JSON.stringify({
        kind: 'command',
        label: 'Start locally',
        command: 'pnpm run dev',
        explanation: 'package.json defines the dev script',
      }),
      stderrChars: 0,
    });
  });

  it('inspects the project through a read-only one-shot Agent call', async () => {
    await expect(
      compileQuickAction({
        intent: 'Start this project locally.',
        projectPath: '/repo',
        runtimeId: 'codex',
      })
    ).resolves.toEqual({
      kind: 'command',
      label: 'Start locally',
      command: 'pnpm run dev',
      explanation: 'package.json defines the dev script',
    });

    expect(mocks.runAgentCli).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/opt/homebrew/bin/codex',
        args: expect.arrayContaining(['--sandbox', 'read-only']),
        cwd: '/repo',
        purpose: 'quick-action-compilation',
        stdin: expect.stringContaining('Start this project locally.'),
      })
    );
  });
});
