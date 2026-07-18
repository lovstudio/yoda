import { describe, expect, it } from 'vitest';
import { shareableProjectSettingsSchema } from './project-settings';

describe('shareableProjectSettingsSchema', () => {
  it('accepts Yoda Build as a project composer mode', () => {
    const parsed = shareableProjectSettingsSchema.parse({
      composerDefaults: { runMode: 'build' },
    });

    expect(parsed.composerDefaults?.runMode).toBe('build');
  });

  it('accepts composer language overrides', () => {
    const parsed = shareableProjectSettingsSchema.parse({
      composerDefaults: {
        inputPromptLanguage: 'skip',
        namingLanguage: 'zh-CN',
        summaryLanguage: 'skip',
      },
    });

    expect(parsed.composerDefaults).toMatchObject({
      inputPromptLanguage: 'skip',
      namingLanguage: 'zh-CN',
      summaryLanguage: 'skip',
    });
  });

  it('rejects invalid composer language overrides', () => {
    expect(() =>
      shareableProjectSettingsSchema.parse({
        composerDefaults: {
          inputPromptLanguage: 'fr',
        },
      })
    ).toThrow();
  });
});
