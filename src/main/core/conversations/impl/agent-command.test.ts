import { describe, expect, it } from 'vitest';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import { runtimeConfigDefaults } from '@main/core/settings/schema';
import { buildAgentCommand } from './agent-command';

function makeConfig(overrides: Partial<RuntimeCustomConfig> = {}): RuntimeCustomConfig {
  return {
    cli: 'claude',
    resumeFlag: '--resume',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    sessionIdFlag: '--session-id',
    ...overrides,
  };
}

describe('buildAgentCommand', () => {
  it('uses the current Codex bypass flag when auto-approve is enabled', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox', 'Fix the issue'],
    });
  });

  it('maps Codex request-approval mode to explicit sandbox and approval flags', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      permissionMode: 'default',
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'untrusted', 'Fix the issue'],
    });
  });

  it('maps Codex approve-for-me mode to on-request approvals', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      permissionMode: 'full-auto',
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', 'Fix the issue'],
    });
  });

  it('lets Codex custom mode inherit config.toml permissions', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      autoApprove: true,
      permissionMode: 'custom',
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['Fix the issue'],
    });
  });

  it('passes prompt principles to Codex as developer instructions', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
      appendSystemPrompt: 'Prefer atomic commits.\nQuote "paths" exactly.',
    });

    expect(command).toEqual({
      command: 'codex',
      args: [
        '-c',
        'developer_instructions="Prefer atomic commits.\\nQuote \\"paths\\" exactly."',
        'Fix the issue',
      ],
    });
  });

  it('resumes the requested Codex session by id', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      sessionId: '019e00e5-0aba-7f30-a13e-ddf5df6cd705',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['resume', '019e00e5-0aba-7f30-a13e-ddf5df6cd705'],
    });
  });

  it('pins Codex resume to the current working directory when provided', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      sessionId: '019e00e5-0aba-7f30-a13e-ddf5df6cd705',
      isResuming: true,
      workingDirectory: '/workspace/current',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['resume', '--cd', '/workspace/current', '019e00e5-0aba-7f30-a13e-ddf5df6cd705'],
    });
  });

  it('supports custom CLI command prefixes and appends managed provider args', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({
        cli: 'caffeinate -i direnv exec . claude',
      }),
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result).toEqual({
      command: 'caffeinate',
      args: [
        '-i',
        'direnv',
        'exec',
        '.',
        'claude',
        '--session-id',
        'conv-1',
        '--dangerously-skip-permissions',
        'Fix the bug',
      ],
    });
  });

  it('preserves quoted custom CLI and flag arguments', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({
        cli: '"/opt/Claude Code/bin/claude"',
        resumeFlag: '--resume "existing session"',
      }),
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.command).toBe('/opt/Claude Code/bin/claude');
    expect(result.args).toEqual(['--resume', 'existing session', 'conv-1']);
  });

  it('parses multi-token session id flags', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({ sessionIdFlag: '--session id' }),
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--session', 'id', 'conv-1']);
  });

  it('puts default args before resume flags for CLIs with subcommands', () => {
    const result = buildAgentCommand({
      runtimeId: 'goose',
      providerConfig: runtimeConfigDefaults.goose,
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['run', '-s', '--resume']);
  });

  it('does not pass Droid session id on fresh sessions', () => {
    const result = buildAgentCommand({
      runtimeId: 'droid',
      providerConfig: runtimeConfigDefaults.droid,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['Fix the bug']);
  });

  it('passes Droid session id when resuming', () => {
    const result = buildAgentCommand({
      runtimeId: 'droid',
      providerConfig: runtimeConfigDefaults.droid,
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['--session-id', 'conv-1']);
  });

  it.each<{
    runtimeId: RuntimeId;
    freshArgs: string[];
    resumeArgs: string[];
  }>([
    { runtimeId: 'cursor', freshArgs: ['Fix the bug'], resumeArgs: ['--resume'] },
    { runtimeId: 'opencode', freshArgs: [], resumeArgs: ['--continue'] },
    { runtimeId: 'copilot', freshArgs: ['Fix the bug'], resumeArgs: ['--resume'] },
    {
      runtimeId: 'auggie',
      freshArgs: ['--allow-indexing', 'Fix the bug'],
      resumeArgs: ['--allow-indexing', '--continue'],
    },
    {
      runtimeId: 'goose',
      freshArgs: ['run', '-s', '-t', 'Fix the bug'],
      resumeArgs: ['run', '-s', '--resume'],
    },
    { runtimeId: 'kimi', freshArgs: ['-c', 'Fix the bug'], resumeArgs: ['--continue'] },
    { runtimeId: 'mistral', freshArgs: ['Fix the bug'], resumeArgs: [] },
  ])('builds fresh and resume args for $runtimeId', ({ runtimeId, freshArgs, resumeArgs }) => {
    const fresh = buildAgentCommand({
      runtimeId,
      providerConfig: runtimeConfigDefaults[runtimeId],
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    const resume = buildAgentCommand({
      runtimeId,
      providerConfig: runtimeConfigDefaults[runtimeId],
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(fresh.args).toEqual(freshArgs);
    expect(resume.args).toEqual(resumeArgs);
  });

  it('appends extra args', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({
        extraArgs: '--model "Claude Sonnet"',
      }),
      sessionId: 'conv-1',
    });

    expect(result.args).toContain('--model');
    expect(result.args).toContain('Claude Sonnet');
  });

  it('rejects shell control syntax that makes managed args ambiguous', () => {
    expect(() =>
      buildAgentCommand({
        runtimeId: 'claude',
        providerConfig: makeConfig({ cli: 'claude | tee log' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });

  it('rejects shell setup in the CLI command field', () => {
    expect(() =>
      buildAgentCommand({
        runtimeId: 'claude',
        providerConfig: makeConfig({ cli: 'source ~/.zshrc && claude' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });

  it('rejects inline environment assignment in the CLI command field', () => {
    expect(() =>
      buildAgentCommand({
        runtimeId: 'claude',
        providerConfig: makeConfig({ cli: 'FOO=bar claude' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });
});
