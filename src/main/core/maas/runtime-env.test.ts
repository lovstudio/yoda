import { describe, expect, it } from 'vitest';
import {
  resolveMaasRuntimeCommandArgs,
  resolveMaasRuntimeEnv,
  resolveRestoredMaasRuntimeConfig,
  supportsMaasRuntimeBinding,
} from './runtime-env';

describe('MaaS Agent Client runtime environment', () => {
  it('maps an OpenAI-compatible MaaS into Codex environment variables', () => {
    expect(
      resolveMaasRuntimeEnv('codex', {
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1/',
        apiKey: 'secret',
      })
    ).toEqual({
      OPENAI_API_KEY: 'secret',
      OPENAI_BASE_URL: 'https://maas.example.test/v1',
    });
  });

  it('selects an invocation-scoped Codex provider with the MaaS endpoint and API key env', () => {
    expect(
      resolveMaasRuntimeCommandArgs('codex', {
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1/',
        apiKey: 'must-not-appear-in-args',
      })
    ).toEqual([
      '-c',
      'model_provider="yoda-maas"',
      '-c',
      'model_providers.yoda-maas.name="Yoda MaaS (ZenMux)"',
      '-c',
      'model_providers.yoda-maas.base_url="https://maas.example.test/v1"',
      '-c',
      'model_providers.yoda-maas.env_key="OPENAI_API_KEY"',
      '-c',
      'model_providers.yoda-maas.wire_api="responses"',
      '-c',
      'model_providers.yoda-maas.requires_openai_auth=false',
      '-c',
      'model_providers.yoda-maas.supports_websockets=false',
    ]);
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
});
