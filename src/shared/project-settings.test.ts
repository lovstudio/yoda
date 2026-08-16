import { describe, expect, it } from 'vitest';
import {
  promptPrincipleSchema,
  quickActionSchema,
  shareableProjectSettingsSchema,
} from './project-settings';

describe('shareableProjectSettingsSchema', () => {
  it('coerces a retired composer mode to vibe coding', () => {
    const parsed = shareableProjectSettingsSchema.parse({
      composerDefaults: { runMode: 'build' },
    });

    expect(parsed.composerDefaults?.runMode).toBe('normal');
  });

  it('accepts composer language overrides, including the legacy skip value', () => {
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

  it('accepts per-capability switches independent of the languages', () => {
    const parsed = shareableProjectSettingsSchema.parse({
      composerDefaults: {
        promptRewriteEnabled: true,
        autoGenerateName: false,
        autoGenerateSummary: false,
        namingLanguage: 'en',
      },
    });

    expect(parsed.composerDefaults).toMatchObject({
      promptRewriteEnabled: true,
      autoGenerateName: false,
      autoGenerateSummary: false,
      namingLanguage: 'en',
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

describe('quickActionSchema', () => {
  it('migrates actions saved before command and Skill quick actions to Skills', () => {
    expect(
      quickActionSchema.parse({
        id: 'release',
        label: 'Release',
        command: '/release-via-cicd',
      })
    ).toEqual({
      id: 'release',
      label: 'Release',
      command: '/release-via-cicd',
      kind: 'skill',
    });
  });

  it('migrates legacy shell actions to commands', () => {
    expect(
      quickActionSchema.parse({
        id: 'dev',
        label: 'Start locally',
        command: 'pnpm run dev',
        kind: 'shell',
      }).kind
    ).toBe('command');
  });
});

describe('promptPrincipleSchema', () => {
  it('keeps legacy inline principles valid', () => {
    const parsed = promptPrincipleSchema.parse({
      id: 'inline',
      name: 'Inline',
      text: 'Always verify.',
      enabled: true,
    });

    expect(parsed.id).toBe('inline');
    expect(parsed.source).toBeUndefined();
  });

  it('accepts persisted file and URL source metadata', () => {
    expect(
      promptPrincipleSchema.parse({
        id: 'remote',
        name: 'Remote',
        text: 'Source-backed content',
        enabled: true,
        source: {
          type: 'url',
          url: 'https://example.com/principle.md',
          refreshIntervalMinutes: 60,
          timeoutSeconds: 10,
          lastSyncedAt: '2026-07-27T00:00:00.000Z',
        },
      }).source
    ).toMatchObject({
      type: 'url',
      refreshIntervalMinutes: 60,
      timeoutSeconds: 10,
    });
  });
});
