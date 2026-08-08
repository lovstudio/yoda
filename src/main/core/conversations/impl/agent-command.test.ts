import { describe, expect, it } from 'vitest';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import { runtimeConfigDefaults } from '@main/core/settings/schema';
import { buildAgentCommand, normalizeRuntimeModelArgs } from './agent-command';

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
  it('rejects new commands for a runtime disabled in Yoda', () => {
    expect(() =>
      buildAgentCommand({
        runtimeId: 'codex',
        providerConfig: { ...runtimeConfigDefaults.codex, disabled: true },
        sessionId: 'session-1',
      })
    ).toThrow('Codex is disabled in Yoda.');
  });

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

  it('starts Codex native Plan mode inside a read-only session without approvals', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      permissionMode: 'plan',
      initialPrompt: 'Inspect the repository and propose a plan',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--sandbox', 'read-only', '--ask-for-approval', 'never'],
      startupInput: '/plan Inspect the repository and propose a plan',
    });
  });

  it('reactivates Codex native Plan mode before a resumed session accepts input', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      permissionMode: 'plan',
      sessionId: '019e00e5-0aba-7f30-a13e-ddf5df6cd705',
      isResuming: true,
      workingDirectory: '/workspace/current',
    });

    expect(command).toEqual({
      command: 'codex',
      args: [
        'resume',
        '--cd',
        '/workspace/current',
        '019e00e5-0aba-7f30-a13e-ddf5df6cd705',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
      ],
      startupInput: '/plan',
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

  it('disables Codex goals for a fresh automation session', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      executionMode: 'automation',
      initialPrompt: 'Run the scheduled check',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--disable', 'goals', 'Run the scheduled check'],
    });
  });

  it('places the Codex goals override before the resume subcommand', () => {
    const command = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      executionMode: 'automation',
      sessionId: '019e00e5-0aba-7f30-a13e-ddf5df6cd705',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--disable', 'goals', 'resume', '019e00e5-0aba-7f30-a13e-ddf5df6cd705'],
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

  it('uses the runtime default model when the Agent does not select one', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: { ...runtimeConfigDefaults.codex, defaultModel: 'gpt-5.6-codex' },
      sessionId: 'conv-1',
    });

    expect(result.args).toContain('--model');
    expect(result.args).toContain('gpt-5.6-codex');
  });

  it('lets the Agent model override the runtime default on fresh and resumed sessions', () => {
    const providerConfig = { ...runtimeConfigDefaults.codex, defaultModel: 'gpt-5.6-codex' };
    const fresh = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig,
      model: 'o4-mini',
      sessionId: 'conv-1',
    });
    const resumed = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig,
      model: 'o4-mini',
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(fresh.args).toContain('o4-mini');
    expect(fresh.args).not.toContain('gpt-5.6-codex');
    expect(resumed.args).toContain('--model');
    expect(resumed.args).toContain('o4-mini');
    expect(resumed.args).not.toContain('gpt-5.6-codex');
  });

  it('does not apply the new-session default while resuming without an explicit model', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: { ...runtimeConfigDefaults.codex, defaultModel: 'gpt-5.6-codex' },
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).not.toContain('--model');
    expect(result.args).not.toContain('gpt-5.6-codex');
  });

  it('applies Codex reasoning and Fast defaults to new sessions', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: {
        ...runtimeConfigDefaults.codex,
        defaultReasoningEffort: 'xhigh',
        defaultFastMode: true,
      },
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual([
      '-c',
      'model_reasoning_effort="xhigh"',
      '-c',
      'service_tier="fast"',
    ]);
  });

  it('only applies Codex reasoning and Fast settings on resume when explicitly requested', () => {
    const providerConfig = {
      ...runtimeConfigDefaults.codex,
      defaultReasoningEffort: 'xhigh',
      defaultFastMode: true,
    };
    const inherited = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig,
      sessionId: 'conv-1',
      isResuming: true,
    });
    const overridden = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig,
      sessionId: 'conv-1',
      isResuming: true,
      reasoningEffort: 'high',
      fastMode: false,
    });

    expect(inherited.args).toEqual(['resume', 'conv-1']);
    expect(overridden.args).toEqual([
      'resume',
      'conv-1',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'service_tier="default"',
    ]);
  });

  it('normalizes duplicate Codex inference config so the managed values win', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: {
        ...runtimeConfigDefaults.codex,
        defaultArgs: ['-c', 'model_reasoning_effort="low"', '--config=service_tier="fast"'],
        extraArgs: '-c=model_reasoning_effort="ultra" --config service_tier="flex"',
      },
      sessionId: 'conv-1',
      reasoningEffort: 'high',
      fastMode: false,
    });

    expect(result.args).toEqual([
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'service_tier="default"',
    ]);
  });

  it('keeps only the Agent model when defaults and extra args also select models', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: {
        ...runtimeConfigDefaults.codex,
        defaultArgs: ['--model', 'default-args-model'],
        defaultModel: 'runtime-default-model',
        extraArgs: '--model=extra-args-model',
      },
      model: 'agent-model',
      initialPrompt: 'Fix the issue',
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--model', 'agent-model', 'Fix the issue']);
  });

  it('removes short model aliases when an Agent model is selected', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: {
        ...runtimeConfigDefaults.codex,
        defaultArgs: ['-m=default-args-model'],
        extraArgs: '-m extra-args-model',
      },
      model: 'agent-model',
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--model', 'agent-model']);
  });

  it('lets the runtime default model override model values in existing args', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: {
        ...runtimeConfigDefaults.codex,
        defaultArgs: ['--model=default-args-model'],
        defaultModel: 'runtime-default-model',
        extraArgs: '--model extra-args-model',
      },
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--model', 'runtime-default-model']);
  });

  it('uses the last existing model value when no Agent or runtime default is set', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({
        defaultArgs: ['--model', 'default-args-model'],
        extraArgs: '--model=extra-args-model',
      }),
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--session-id', 'conv-1', '--model', 'extra-args-model']);
  });

  it('normalizes equals-form and multi-token model flags', () => {
    expect(
      normalizeRuntimeModelArgs(
        ['--config', 'model=old-model', '--verbose', '--config', 'model', 'new-model'],
        '--config model'
      )
    ).toEqual(['--verbose', '--config', 'model', 'new-model']);
    expect(normalizeRuntimeModelArgs(['--model', 'old-model'], '--model=', 'new-model')).toEqual([
      '--model=new-model',
    ]);
  });

  it('normalizes an explicit resume-time model override', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: makeConfig({
        defaultArgs: ['--model', 'default-args-model'],
        defaultModel: 'runtime-default-model',
        extraArgs: '--model=extra-args-model',
      }),
      model: 'agent-model',
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['--resume', 'conv-1', '--model', 'agent-model']);
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
