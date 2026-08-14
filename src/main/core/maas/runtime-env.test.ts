import { describe, expect, it } from 'vitest';
import {
  resolveCodexMaasModelId,
  resolveCodexMaasRuntimeArgs,
  resolveCodexNativeModelId,
  resolveCodexOfficialRuntimeArgs,
  resolveMaasRuntimeEnv,
  resolveRestoredMaasRuntimeConfig,
  rewriteCodexMaasModelArgs,
  supportsMaasRuntimeBinding,
} from './runtime-env';

describe('MaaS Agent Client runtime environment', () => {
  it('injects the encrypted MaaS key under the env_key referenced by Codex config', () => {
    expect(
      resolveMaasRuntimeEnv('codex', {
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1/',
        apiKey: 'secret',
      })
    ).toEqual({ ZENMUX_API_KEY: 'secret' });
  });

  it('builds invocation-scoped Codex provider args without putting the key on the command line', () => {
    const args = resolveCodexMaasRuntimeArgs({
      platformId: 'custom:lovstudio',
      displayName: 'LovStudio LLM',
      endpoint: 'https://llm.lovstudio.test/v1/',
      envKey: 'LOVSTUDIO_LLM_API_KEY',
      apiKey: 'super-secret',
    });

    expect(args.join(' ')).toContain('model_providers.yoda.env_key="LOVSTUDIO_LLM_API_KEY"');
    expect(args.join(' ')).toContain(
      'model_providers.yoda.base_url="https://llm.lovstudio.test/v1"'
    );
    expect(args.join(' ')).not.toContain('super-secret');
  });

  it('runs the native OpenAI account under the same shared history provider', () => {
    expect(resolveCodexOfficialRuntimeArgs()).toEqual([
      '-c',
      'model_provider="yoda"',
      '-c',
      'model_providers.yoda.name="OpenAI"',
      '-c',
      'model_providers.yoda.requires_openai_auth=true',
      '-c',
      'model_providers.yoda.supports_websockets=true',
      '-c',
      'model_providers.yoda.wire_api="responses"',
    ]);
  });

  it('restores the provider prefix required by the ZenMux model namespace', () => {
    const credentials = {
      platformId: 'profile:zenmux' as const,
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'secret',
    };

    expect(resolveCodexMaasModelId(credentials, 'gpt-5.6-sol')).toBe('openai/gpt-5.6-sol');
    expect(resolveCodexMaasModelId(credentials, 'openai/gpt-5.6-sol')).toBe('openai/gpt-5.6-sol');
    expect(resolveCodexNativeModelId('openai/gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(
      rewriteCodexMaasModelArgs(
        ['--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high"'],
        credentials
      )
    ).toEqual(['--model', 'openai/gpt-5.6-sol', '-c', 'model_reasoning_effort="high"']);
  });

  it('recognizes a newly created ZenMux Profile by endpoint without changing direct providers', () => {
    expect(
      resolveCodexMaasModelId(
        {
          platformId: 'profile:new-zenmux',
          displayName: 'My route',
          endpoint: 'https://zenmux.ai/api/v1',
          apiKey: 'secret',
        },
        'gpt-5.6-sol'
      )
    ).toBe('openai/gpt-5.6-sol');
    expect(
      resolveCodexMaasModelId(
        {
          platformId: 'profile:direct-openai',
          displayName: 'Direct OpenAI',
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'secret',
        },
        'gpt-5.6-sol'
      )
    ).toBe('gpt-5.6-sol');
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
