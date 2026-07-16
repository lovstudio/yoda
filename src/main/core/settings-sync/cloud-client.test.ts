import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsCloudClient } from './cloud-client';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@main/core/account/services/lovstudio-api-client', () => ({
  lovStudioApiClient: { request: mocks.request },
}));

describe('settings cloud client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads settings through the authenticated Yoda account endpoint', async () => {
    mocks.request.mockResolvedValue({ snapshot: null, revision: null, updatedAt: null });
    const client = new SettingsCloudClient();

    await client.get('user-1', 4);

    expect(mocks.request).toHaveBeenCalledWith(
      '/api/yoda/settings',
      { method: 'GET' },
      { expectedUserId: 'user-1', expectedGeneration: 4 }
    );
  });

  it('writes a revision-bound snapshot and supports explicit conflict override', async () => {
    mocks.request.mockResolvedValue({ revision: 'revision-2' });
    const client = new SettingsCloudClient();
    const snapshot = {
      kind: 'yoda-settings' as const,
      version: 1 as const,
      appVersion: '1.0.0',
      exportedAt: '2026-07-16T00:00:00.000Z',
      data: { appSettings: {}, runtimeConfigs: {}, viewState: {}, rendererStorage: {} },
    };

    await client.put('user-1', 4, snapshot, { baseRevision: 'revision-1', force: true });

    expect(mocks.request).toHaveBeenCalledWith(
      '/api/yoda/settings',
      {
        method: 'PUT',
        body: JSON.stringify({
          snapshot,
          baseRevision: 'revision-1',
          force: true,
        }),
      },
      { expectedUserId: 'user-1', expectedGeneration: 4 }
    );
  });
});
