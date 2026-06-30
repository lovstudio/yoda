import { describe, expect, it } from 'vitest';
import {
  createDefaultLlmProfile,
  DEFAULT_LLM_PROFILE_ID,
  getLlmProfile,
  normalizeLlmSettings,
  type GlobalLlmSettingsShape,
} from './global-llm';

describe('normalizeLlmSettings', () => {
  it('creates a default profile when settings are empty', () => {
    const settings = normalizeLlmSettings(null);

    expect(settings.profiles).toHaveLength(1);
    expect(settings.defaultProfileId).toBe(DEFAULT_LLM_PROFILE_ID);
    expect(settings.namingProfileId).toBe(DEFAULT_LLM_PROFILE_ID);
    expect(settings.promptTranslationProfileId).toBe(DEFAULT_LLM_PROFILE_ID);
  });

  it('migrates the legacy direct MaaS switch into a profile access method', () => {
    const settings = normalizeLlmSettings({
      maasEnabled: true,
      maasModel: 'openai/gpt-5-mini',
      promptTranslationEnabled: true,
    });

    expect(settings.profiles[0]).toMatchObject({
      id: DEFAULT_LLM_PROFILE_ID,
      authProvider: 'yoda-maas',
      model: 'openai/gpt-5-mini',
    });
    expect(settings.promptTranslationEnabled).toBe(true);
  });

  it('migrates legacy routing fields even after defaults add a profile', () => {
    const settings = normalizeLlmSettings({
      profiles: [createDefaultLlmProfile()],
      defaultProfileId: DEFAULT_LLM_PROFILE_ID,
      namingProfileId: DEFAULT_LLM_PROFILE_ID,
      promptTranslationProfileId: DEFAULT_LLM_PROFILE_ID,
      maasEnabled: true,
      maasModel: 'anthropic/claude-sonnet-4-5',
    });

    expect(settings.profiles[0]).toMatchObject({
      authProvider: 'yoda-maas',
      model: 'anthropic/claude-sonnet-4-5',
    });
  });

  it('normalizes missing profile selections to the default profile', () => {
    const settings = normalizeLlmSettings(
      profileSettings({
        defaultProfileId: 'fast',
        namingProfileId: 'missing',
        promptTranslationProfileId: 'also-missing',
      })
    );

    expect(settings.defaultProfileId).toBe('fast');
    expect(settings.namingProfileId).toBe('fast');
    expect(settings.promptTranslationProfileId).toBe('fast');
  });
});

describe('getLlmProfile', () => {
  it('returns the requested profile when it exists', () => {
    const settings = profileSettings();

    expect(getLlmProfile(settings, 'accurate').name).toBe('Accurate');
  });

  it('falls back to the default profile', () => {
    const settings = profileSettings({ defaultProfileId: 'fast' });

    expect(getLlmProfile(settings, 'missing').id).toBe('fast');
  });
});

function profileSettings(overrides: Partial<GlobalLlmSettingsShape> = {}): GlobalLlmSettingsShape {
  return {
    profiles: [
      createDefaultLlmProfile({ id: 'fast', name: 'Fast', model: 'fast-model' }),
      createDefaultLlmProfile({
        id: 'accurate',
        name: 'Accurate',
        model: 'accurate-model',
      }),
    ],
    defaultProfileId: 'fast',
    namingProfileId: 'fast',
    promptTranslationEnabled: false,
    promptTranslationProfileId: 'fast',
    promptTranslationShowOriginal: true,
    ...overrides,
  };
}
