import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { YodaSettingsArchive } from '@shared/settings-sync';
import { SettingsSyncService } from './service';

const mocks = vi.hoisted(() => {
  const kv = new Map<string, unknown>();
  return {
    kv,
    getSession: vi.fn(),
    getRequestSession: vi.fn(),
    isRequestSessionCurrent: vi.fn(() => true),
    cloudGet: vi.fn(),
    cloudPut: vi.fn(),
    createArchive: vi.fn(),
    parseArchive: vi.fn((archive: YodaSettingsArchive) => archive),
    applyArchive: vi.fn(),
    digest: vi.fn(
      (archive: YodaSettingsArchive) => archive.data.rendererStorage.digest ?? 'digest'
    ),
  };
});

vi.mock('electron', () => ({
  app: { relaunch: vi.fn(), quit: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
}));

vi.mock('@main/db/kv', () => ({
  KV: class KV {
    async get(key: string) {
      return mocks.kv.get(key) ?? null;
    }
    async setStrict(key: string, value: unknown) {
      mocks.kv.set(key, value);
    }
  },
}));

vi.mock('@main/core/account/services/yoda-account-service', () => ({
  yodaAccountService: {
    getSession: mocks.getSession,
    getRequestSession: mocks.getRequestSession,
    isRequestSessionCurrent: mocks.isRequestSessionCurrent,
  },
}));

vi.mock('@main/core/account/services/lovstudio-api-client', () => ({
  LovStudioApiError: class LovStudioApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock('@main/core/app/utils', () => ({ resolveAppVersion: vi.fn(async () => '1.0.0') }));

vi.mock('./cloud-client', () => ({
  settingsCloudClient: { get: mocks.cloudGet, put: mocks.cloudPut },
}));

vi.mock('./archive', () => ({
  createSettingsArchive: mocks.createArchive,
  parseSettingsArchive: mocks.parseArchive,
  applySettingsArchive: mocks.applyArchive,
  settingsArchiveDigest: mocks.digest,
}));

function archive(digest: string): YodaSettingsArchive {
  return {
    kind: 'yoda-settings',
    version: 1,
    appVersion: '1.0.0',
    exportedAt: '2026-07-16T00:00:00.000Z',
    data: {
      appSettings: {},
      runtimeConfigs: {},
      viewState: {},
      rendererStorage: { digest },
    },
  };
}

describe('settings sync service', () => {
  beforeEach(() => {
    mocks.kv.clear();
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      isSignedIn: true,
      hasAccount: true,
      user: { userId: 'user-1' },
    });
    mocks.getRequestSession.mockResolvedValue({
      userId: 'user-1',
      generation: 3,
      accessToken: 'token',
      signal: new AbortController().signal,
    });
    mocks.createArchive.mockResolvedValue(archive('local-new'));
  });

  it('downloads cloud settings on the first sync of another installation', async () => {
    const remote = archive('remote');
    mocks.cloudGet.mockResolvedValue({
      snapshot: remote,
      revision: 'revision-2',
      updatedAt: '2026-07-16T01:00:00.000Z',
    });
    const service = new SettingsSyncService();

    await expect(service.sync({}, 'auto')).resolves.toMatchObject({
      status: 'downloaded',
      rendererStorage: { digest: 'remote' },
    });
    expect(mocks.applyArchive).toHaveBeenCalledWith(remote);
    expect(mocks.cloudPut).not.toHaveBeenCalled();
  });

  it('reports a conflict when local and cloud settings both changed', async () => {
    mocks.kv.set('metadata', {
      userId: 'user-1',
      revision: 'revision-1',
      digest: 'local-old',
      lastSyncedAt: '2026-07-15T00:00:00.000Z',
      cloudUpdatedAt: '2026-07-15T00:00:00.000Z',
    });
    mocks.cloudGet.mockResolvedValue({
      snapshot: archive('remote-new'),
      revision: 'revision-2',
      updatedAt: '2026-07-16T01:00:00.000Z',
    });
    const service = new SettingsSyncService();

    await expect(service.sync({}, 'auto')).resolves.toMatchObject({ status: 'conflict' });
    expect(mocks.applyArchive).not.toHaveBeenCalled();
    expect(mocks.cloudPut).not.toHaveBeenCalled();
  });

  it('uploads local settings when the cloud has no snapshot', async () => {
    mocks.cloudGet.mockResolvedValue({ snapshot: null, revision: null, updatedAt: null });
    mocks.cloudPut.mockResolvedValue({
      snapshot: archive('local-new'),
      revision: 'revision-1',
      updatedAt: '2026-07-16T02:00:00.000Z',
    });
    const service = new SettingsSyncService();

    await expect(service.sync({}, 'auto')).resolves.toMatchObject({ status: 'uploaded' });
    expect(mocks.cloudPut).toHaveBeenCalledWith('user-1', 3, expect.any(Object), {
      baseRevision: null,
      force: false,
    });
  });

  it('supports explicitly overwriting the cloud with local settings', async () => {
    mocks.cloudGet.mockResolvedValue({
      snapshot: archive('remote'),
      revision: 'revision-7',
      updatedAt: '2026-07-16T01:00:00.000Z',
    });
    mocks.cloudPut.mockResolvedValue({
      snapshot: archive('local-new'),
      revision: 'revision-8',
      updatedAt: '2026-07-16T02:00:00.000Z',
    });
    const service = new SettingsSyncService();

    await expect(service.sync({}, 'upload')).resolves.toMatchObject({ status: 'uploaded' });
    expect(mocks.cloudPut).toHaveBeenCalledWith('user-1', 3, expect.any(Object), {
      baseRevision: 'revision-7',
      force: true,
    });
  });
});
