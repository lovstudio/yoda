import { describe, expect, it } from 'vitest';
import {
  resolveAgentApiEnvVars,
  resolveRuntimeBaseEnv,
  resolveRuntimeEnv,
  resolveRuntimeStateDirectory,
  resolveRuntimeTmuxEnv,
} from './runtime-env';

describe('resolveRuntimeEnv', () => {
  it('returns valid provider environment variables', () => {
    expect(
      resolveRuntimeEnv({
        env: {
          ANTHROPIC_BASE_URL: 'https://example.test',
          _TOKEN: 'secret',
          'INVALID-NAME': 'ignored',
          '1TOKEN': 'ignored',
        },
      })
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://example.test',
      _TOKEN: 'secret',
    });
  });

  it('returns undefined when no valid provider environment variables exist', () => {
    expect(resolveRuntimeEnv(undefined)).toBeUndefined();
    expect(resolveRuntimeEnv({ env: { 'INVALID-NAME': 'ignored' } })).toBeUndefined();
  });

  it('omits official API variables when native subscription auth is selected', () => {
    expect(
      resolveRuntimeEnv(
        {
          authProvider: 'official-subscription',
          env: {
            OPENAI_API_KEY: 'secret',
            OPENAI_BASE_URL: 'https://api.example.test',
            CUSTOM_RUNTIME_FLAG: '1',
          },
        },
        { runtimeId: 'codex' }
      )
    ).toEqual({
      CUSTOM_RUNTIME_FLAG: '1',
    });
  });

  it('omits official API variables when Yoda MaaS auth is selected', () => {
    expect(
      resolveRuntimeEnv(
        {
          authProvider: 'yoda-maas',
          env: {
            ANTHROPIC_API_KEY: 'secret',
            CUSTOM_RUNTIME_FLAG: '1',
          },
        },
        { runtimeId: 'claude' }
      )
    ).toEqual({
      CUSTOM_RUNTIME_FLAG: '1',
    });
  });

  it('keeps official API variables when official API auth is selected', () => {
    expect(
      resolveRuntimeEnv(
        {
          authProvider: 'official-api',
          env: {
            OPENAI_API_KEY: 'secret',
            CUSTOM_RUNTIME_FLAG: '1',
          },
        },
        { runtimeId: 'codex' }
      )
    ).toEqual({
      OPENAI_API_KEY: 'secret',
      CUSTOM_RUNTIME_FLAG: '1',
    });
  });

  it('filters inherited official API variables when another auth provider is selected', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'secret',
      OPENAI_BASE_URL: 'https://api.example.test',
      PATH: '/bin',
    };

    expect(resolveRuntimeBaseEnv(baseEnv, { authProvider: 'yoda-maas' }, 'codex')).toEqual({
      PATH: '/bin',
    });
    expect(resolveRuntimeBaseEnv(baseEnv, { authProvider: 'official-api' }, 'codex')).toBe(baseEnv);
  });

  it('resolves inherited API env passthrough by selected auth provider', () => {
    expect(resolveAgentApiEnvVars({ authProvider: 'official-api' }, 'codex')).toEqual([
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_API_ENDPOINT',
    ]);
    expect(resolveAgentApiEnvVars({ authProvider: 'official-subscription' }, 'codex')).toBe(false);
  });

  it('forces Claude Code classic rendering inside tmux', () => {
    expect(resolveRuntimeEnv(undefined, { runtimeId: 'claude', tmuxEnabled: true })).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    });
  });

  it('does not force classic rendering for non-tmux or non-Claude sessions', () => {
    expect(
      resolveRuntimeEnv(undefined, { runtimeId: 'claude', tmuxEnabled: false })
    ).toBeUndefined();
    expect(resolveRuntimeEnv(undefined, { runtimeId: 'codex', tmuxEnabled: true })).toBeUndefined();
  });

  it('preserves explicit Claude alternate screen environment overrides', () => {
    expect(
      resolveRuntimeEnv(
        {
          env: {
            CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '0',
          },
        },
        { runtimeId: 'claude', tmuxEnabled: true }
      )
    ).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '0',
    });
  });

  it('limits tmux environment propagation to safe renderer variables', () => {
    expect(
      resolveRuntimeTmuxEnv({
        CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
        ANTHROPIC_API_KEY: 'secret',
      })
    ).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    });
  });

  it('resolves provider state directories with runtime config taking precedence', () => {
    expect(
      resolveRuntimeStateDirectory(
        'codex',
        { env: { CODEX_HOME: '/provider/codex' } },
        { processEnv: { CODEX_HOME: '/inherited/codex' }, home: '/home/user' }
      )
    ).toBe('/provider/codex');
    expect(
      resolveRuntimeStateDirectory(
        'claude',
        { env: { CLAUDE_CONFIG_DIR: '/provider/claude' } },
        { processEnv: { CLAUDE_CONFIG_DIR: '/inherited/claude' }, home: '/home/user' }
      )
    ).toBe('/provider/claude');
  });

  it('falls back from inherited state directories to provider defaults', () => {
    expect(
      resolveRuntimeStateDirectory('codex', undefined, {
        processEnv: { CODEX_HOME: '/inherited/codex' },
        home: '/home/user',
      })
    ).toBe('/inherited/codex');
    expect(
      resolveRuntimeStateDirectory('claude', undefined, {
        processEnv: {},
        home: '/home/user',
      })
    ).toBe('/home/user/.claude');
  });
});
