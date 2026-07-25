import { describe, expect, it } from 'vitest';
import {
  resolveMaasRuntimeCommandArgs,
  resolveMaasRuntimeEnv,
  resolveRestoredMaasRuntimeConfig,
  supportsMaasRuntimeBinding,
} from './runtime-env';

describe('MaaS Agent Client runtime environment', () => {
  it('uses the persisted Codex MaaS login instead of an ignored env override', () => {
    expect(
      resolveMaasRuntimeEnv('codex', {
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1/',
        apiKey: 'secret',
      })
    ).toBeUndefined();
  });

  it('keeps Codex on its built-in OpenAI provider while overriding the MaaS endpoint', () => {
    const args = resolveMaasRuntimeCommandArgs('codex', {
      platformId: 'zenmux',
      endpoint: 'https://maas.example.test/v1/',
      apiKey: 'must-not-appear-in-args',
    });

    expect(args).toEqual([
      '-c',
      'model_provider="openai"',
      '-c',
      'openai_base_url="https://maas.example.test/v1"',
    ]);
    expect(args.join(' ')).not.toContain('yoda-maas');
    expect(args.join(' ')).not.toContain('model_providers.');
    expect(args.join(' ')).not.toContain('must-not-appear-in-args');
  });

  it('does not add Codex provider arguments to other MaaS runtimes', () => {
    expect(
      resolveMaasRuntimeCommandArgs('claude', {
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1',
        apiKey: 'secret',
      })
    ).toEqual([]);
  });

  it('maps an Anthropic-compatible MaaS into Claude environment variables', () => {
    expect(
      resolveMaasRuntimeEnv('claude', {
        platformId: 'openrouter',
        endpoint: 'https://maas.example.test/anthropic',
        apiKey: 'secret',
      })
    ).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: 'https://maas.example.test/anthropic',
    });
  });

  it('derives the native Anthropic endpoints required by Claude Code', () => {
    expect(
      resolveMaasRuntimeEnv('claude', {
        platformId: 'zenmux',
        endpoint: 'https://zenmux.ai/api/v1',
        apiKey: 'secret',
      })
    ).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://zenmux.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(
      resolveMaasRuntimeEnv('claude', {
        platformId: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        apiKey: 'secret',
      })?.ANTHROPIC_BASE_URL
    ).toBe('https://openrouter.ai/api');
  });

  it('only offers switching for Clients with a concrete environment adapter', () => {
    expect(supportsMaasRuntimeBinding('codex')).toBe(true);
    expect(supportsMaasRuntimeBinding('claude')).toBe(true);
    expect(supportsMaasRuntimeBinding('qwen')).toBe(false);
    expect(supportsMaasRuntimeBinding('not-a-runtime')).toBe(false);
  });

  it('restores the previous access configuration without dropping unrelated Client settings', () => {
    expect(
      resolveRestoredMaasRuntimeConfig(
        {
          authProvider: 'yoda-maas',
          maasPlatformId: 'zenmux',
          defaultModel: 'gpt-5',
          env: { CUSTOM_RUNTIME_FLAG: '1' },
        },
        {
          runtimeId: 'codex',
          platformId: 'zenmux',
          previousAuthProvider: 'official-api',
          previousMaasPlatformId: null,
          enabledAt: '2026-07-16T00:00:00.000Z',
        }
      )
    ).toEqual({
      authProvider: 'official-api',
      defaultModel: 'gpt-5',
      env: { CUSTOM_RUNTIME_FLAG: '1' },
    });
  });

  it('restores the exact pre-MaaS Client snapshot when one is available', () => {
    expect(
      resolveRestoredMaasRuntimeConfig(
        {
          authProvider: 'yoda-maas',
          maasPlatformId: 'openrouter',
          defaultModel: 'changed-while-enabled',
          extraArgs: '--temporary',
          env: { TEMPORARY: '1' },
        },
        {
          runtimeId: 'codex',
          platformId: 'openrouter',
          previousAuthProvider: 'official-subscription',
          previousMaasPlatformId: null,
          previousConfig: {
            authProvider: 'official-subscription',
            defaultModel: 'before-maas',
            extraArgs: '--original',
            env: { ORIGINAL: '1' },
          },
          enabledAt: '2026-07-16T00:00:00.000Z',
        }
      )
    ).toEqual({
      authProvider: 'official-subscription',
      defaultModel: 'before-maas',
      extraArgs: '--original',
      env: { ORIGINAL: '1' },
    });
  });
});
