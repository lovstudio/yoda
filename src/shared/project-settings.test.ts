import { describe, expect, it } from 'vitest';
import { shareableProjectSettingsSchema } from './project-settings';

describe('shareableProjectSettingsSchema', () => {
  it('accepts composer language overrides', () => {
    const parsed = shareableProjectSettingsSchema.parse({
      composerDefaults: {
        namingLanguage: 'zh-CN',
        summaryLanguage: 'en',
      },
    });

    expect(parsed.composerDefaults).toMatchObject({
      namingLanguage: 'zh-CN',
      summaryLanguage: 'en',
    });
  });

  it('rejects invalid composer language overrides', () => {
    expect(() =>
      shareableProjectSettingsSchema.parse({
        composerDefaults: {
          namingLanguage: 'fr',
        },
      })
    ).toThrow();
  });
});
