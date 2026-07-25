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

    expect(maas.selectedPlatformId).toBe('custom:first');
    expect(maas.connections[0]?.platformId).toBe('custom:first');
    expect(profile.maasPlatformId).toBe('custom:first');
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
});
