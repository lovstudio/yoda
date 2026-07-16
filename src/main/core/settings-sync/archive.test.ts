import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { YodaSettingsArchive } from '@shared/settings-sync';
import {
  applySettingsArchive,
  createSettingsArchive,
  parseSettingsArchive,
  sanitizeRuntimeConfig,
  settingsArchiveDigest,
} from './archive';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  replaceMany: vi.fn(),
  getOverrides: vi.fn(),
  replaceOverrides: vi.fn(),
  viewGet: vi.fn(),
  viewSave: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { getAll: mocks.getAll, replaceMany: mocks.replaceMany },
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getOverrides: mocks.getOverrides,
    replaceOverrides: mocks.replaceOverrides,
  },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { get: mocks.viewGet, save: mocks.viewSave },
}));

describe('settings archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAll.mockResolvedValue({
      project: {},
      tasks: {},
      runtimeAutoApproveDefaults: {},
      runtimePermissionModes: {},
      automations: { items: [] },
      kanban: { hooksByStatus: {} },
      maas: {
        selectedPlatformId: 'zenmux',
        connections: [
          {
            platformId: 'zenmux',
            displayName: 'ZenMux',
            endpoint: 'https://example.test',
            keyFingerprint: 'sk...23',
            inferenceKeyFingerprint: 'sk...45',
            connectedAt: '2026-07-16T00:00:00.000Z',
            lastCheckedAt: '2026-07-16T00:00:00.000Z',
          },
        ],
        runtimeBindings: [],
      },
      llm: {},
      defaultRuntime: 'claude',
      keyboard: {},
      notifications: {},
      theme: 'ygreen',
      systemThemes: {},
      openIn: {},
      interface: {},
      terminal: {},
      customThemes: {},
      browserPreview: {},
      statusline: {},
      promptPrinciples: {},
      updates: {},
      localProject: { defaultProjectsDirectory: '/private/device/path' },
      runtimeModelCandidates: { runtimes: { claude: ['cache'] } },
      homeDraft: { prompt: 'unfinished work' },
    });
    mocks.getOverrides.mockResolvedValue({
      claude: {
        cli: 'claude',
        env: {
          ANTHROPIC_API_KEY: 'secret',
          HTTP_PROXY: 'http://127.0.0.1:7890',
        },
      },
    });
    mocks.viewGet.mockResolvedValue({
      expandedProjectIds: ['project-a'],
      activeWorkspaceId: 'workspace-a',
      taskSortBy: 'updated-at',
      hideProjectsWithoutActiveTasks: true,
    });
  });

  it('exports portable settings while removing secrets and entity-bound state', async () => {
    const archive = await createSettingsArchive('1.2.3', {
      'yoda-theme': '"ygreen"',
    });

    expect(archive.data.appSettings).not.toHaveProperty('localProject');
    expect(archive.data.appSettings).not.toHaveProperty('runtimeModelCandidates');
    expect(archive.data.appSettings).not.toHaveProperty('homeDraft');
    expect(archive.data.appSettings.maas?.connections[0]).toMatchObject({
      keyFingerprint: null,
      inferenceKeyFingerprint: null,
      lastCheckedAt: null,
    });
    expect(archive.data.runtimeConfigs.claude?.env).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
    });
    expect(archive.data.viewState.sidebar).toEqual({
      taskSortBy: 'updated-at',
      hideProjectsWithoutActiveTasks: true,
    });
  });

  it('sanitizes sensitive environment variable names', () => {
    expect(
      sanitizeRuntimeConfig({
        env: {
          TOKEN: 'a',
          customPassword: 'b',
          Authorization: 'c',
          NO_PROXY: 'localhost',
        },
      }).env
    ).toEqual({ NO_PROXY: 'localhost' });
  });

  it('parses, applies, and hashes archive data independent of export time', async () => {
    const archive = await createSettingsArchive('1.2.3', {});
    const portable = {
      ...archive,
      data: {
        appSettings: {},
        runtimeConfigs: { claude: { env: { HTTP_PROXY: 'http://proxy.test' } } },
        viewState: { sidebar: { taskSortBy: 'updated-at' } },
        rendererStorage: {},
      },
    } satisfies YodaSettingsArchive;
    const newer = { ...portable, exportedAt: '2099-01-01T00:00:00.000Z' };
    const parsed = parseSettingsArchive(newer);
    expect(settingsArchiveDigest(parsed)).toBe(settingsArchiveDigest(portable));

    await applySettingsArchive(parsed);
    expect(mocks.replaceMany).toHaveBeenCalledWith(parsed.data.appSettings);
    expect(mocks.replaceOverrides).toHaveBeenCalledWith({
      claude: {
        env: {
          ANTHROPIC_API_KEY: 'secret',
          HTTP_PROXY: 'http://proxy.test',
        },
      },
    });
    expect(mocks.viewSave).toHaveBeenCalledWith(
      'sidebar',
      expect.objectContaining({
        expandedProjectIds: ['project-a'],
        taskSortBy: 'updated-at',
      })
    );
  });

  it('hashes semantically identical objects independently of key order', () => {
    const first = {
      kind: 'yoda-settings',
      version: 1,
      appVersion: '1',
      exportedAt: 'now',
      data: {
        appSettings: { keyboard: { settings: 'Meta+,' }, theme: 'ygreen' },
        runtimeConfigs: {},
        viewState: {},
        rendererStorage: {},
      },
    } satisfies YodaSettingsArchive;
    const second = {
      ...first,
      data: {
        ...first.data,
        appSettings: { theme: 'ygreen' as const, keyboard: { settings: 'Meta+,' } },
      },
    };
    expect(settingsArchiveDigest(first)).toBe(settingsArchiveDigest(second));
  });

  it('rejects files that are not Yoda settings archives', () => {
    expect(() => parseSettingsArchive({ kind: 'other', version: 1, data: {} })).toThrow(
      'not a Yoda settings archive'
    );
  });

  it('does not restore unapproved renderer storage entries', () => {
    const archive = {
      kind: 'yoda-settings',
      version: 1,
      appVersion: '1.0.0',
      exportedAt: '2026-07-16T00:00:00.000Z',
      data: {
        appSettings: {},
        runtimeConfigs: {},
        viewState: {},
        rendererStorage: { safe: 'value' },
      },
    } satisfies YodaSettingsArchive;
    expect(parseSettingsArchive(archive).data.rendererStorage).toEqual({ safe: 'value' });
  });

  it('drops unknown runtimes and malformed sidebar preferences', () => {
    const archive = {
      kind: 'yoda-settings',
      version: 1,
      appVersion: '1.0.0',
      exportedAt: '2026-07-16T00:00:00.000Z',
      data: {
        appSettings: {},
        runtimeConfigs: { __proto__: { env: { TOKEN: 'secret' } }, unknown: { cli: 'evil' } },
        viewState: {
          sidebar: {
            taskSortBy: { malformed: true },
            taskGroupBy: 'project',
            projectsCollapsed: 'yes',
          },
        },
        rendererStorage: {},
      },
    };
    const parsed = parseSettingsArchive(archive);
    expect(parsed.data.runtimeConfigs).toEqual({});
    expect(parsed.data.viewState.sidebar).toEqual({ taskGroupBy: 'project' });
  });
});
