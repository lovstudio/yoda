import { describe, expect, it } from 'vitest';
import { llmProfileSchema, maasSettingsSchema } from './schema';

describe('MaaS settings schema', () => {
  it('persists dynamic Custom instance IDs in connections and LLM profiles', () => {
    const maas = maasSettingsSchema.parse({
      selectedPlatformId: 'custom:first',
      connections: [
        {
          platformId: 'custom:first',
          displayName: 'First Custom',
          endpoint: 'https://first.example.test/v1',
          keyFingerprint: 'fi...st',
          inferenceKeyFingerprint: 'fi...st',
          connectedAt: null,
          lastCheckedAt: null,
        },
      ],
      runtimeBindings: [],
    });
    const profile = llmProfileSchema.parse({
      id: 'custom-profile',
      name: 'Custom profile',
      runtimeId: 'codex',
      authProvider: 'yoda-maas',
      maasPlatformId: 'custom:first',
      model: 'model',
      reasoningEffort: 'default',
      permissionMode: 'default',
    });

    expect(maas.selectedPlatformId).toBe('profile:custom:first');
    expect(maas.connections[0]?.platformId).toBe('profile:custom:first');
    expect(maas.connections[0]?.envKey).toBeUndefined();
    expect(maas.connections[0]?.syncToAgentClient).toBeUndefined();
    expect(maas.connections[0]?.syncToAgentClientVersion).toBeUndefined();
    expect(profile.maasPlatformId).toBe('profile:custom:first');
  });

  it('persists explicit global consent for durable external Agent Client sync', () => {
    const maas = maasSettingsSchema.parse({
      selectedPlatformId: 'zenmux',
      externalAgentSyncEnabled: true,
      externalAgentSyncVersion: 1,
      connections: [
        {
          platformId: 'zenmux',
          displayName: 'ZenMux',
          endpoint: 'https://zenmux.ai/api/v1',
          envKey: 'ZENMUX_API_KEY',
          keyFingerprint: 'ke...ey',
          inferenceKeyFingerprint: 'ke...ey',
          connectedAt: null,
          lastCheckedAt: null,
        },
      ],
      runtimeBindings: [],
    });

    expect(maas.externalAgentSyncEnabled).toBe(true);
    expect(maas.externalAgentSyncVersion).toBe(1);
    expect(maas.connections[0]?.syncToAgentClientVersion).toBeUndefined();
  });

  it('rejects an empty Custom instance suffix', () => {
    expect(
      maasSettingsSchema.safeParse({
        selectedPlatformId: 'custom:',
        connections: [],
        runtimeBindings: [],
      }).success
    ).toBe(false);
  });

  it('persists a complete pre-MaaS Client snapshot and accepts legacy bindings', () => {
    const parsed = maasSettingsSchema.parse({
      selectedPlatformId: 'zenmux',
      connections: [],
      runtimeBindings: [
        {
          runtimeId: 'codex',
          platformId: 'zenmux',
          previousAuthProvider: 'official-api',
          previousMaasPlatformId: null,
          previousConfig: {
            authProvider: 'official-api',
            defaultModel: 'gpt-5',
            extraArgs: '--original',
            env: { ORIGINAL: '1' },
          },
          enabledAt: '2026-07-25T00:00:00.000Z',
        },
        {
          runtimeId: 'claude',
          platformId: 'zenmux',
          previousAuthProvider: 'official-subscription',
          previousMaasPlatformId: null,
          enabledAt: '2026-07-24T00:00:00.000Z',
        },
      ],
    });

    expect(parsed.runtimeBindings[0]?.previousConfig).toEqual({
      authProvider: 'official-api',
      defaultModel: 'gpt-5',
      extraArgs: '--original',
      env: { ORIGINAL: '1' },
    });
    expect(parsed.runtimeBindings[1]).not.toHaveProperty('previousConfig');
  });
});
