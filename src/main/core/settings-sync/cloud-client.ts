import type { YodaSettingsArchive } from '@shared/settings-sync';
import { lovStudioApiClient } from '@main/core/account/services/lovstudio-api-client';

export type CloudSettingsSnapshot = {
  snapshot: YodaSettingsArchive | null;
  revision: string | null;
  updatedAt: string | null;
};

export class SettingsCloudClient {
  get(expectedUserId: string, expectedGeneration: number): Promise<CloudSettingsSnapshot> {
    return lovStudioApiClient.request<CloudSettingsSnapshot>(
      '/api/yoda/settings',
      { method: 'GET' },
      { expectedUserId, expectedGeneration }
    );
  }

  put(
    expectedUserId: string,
    expectedGeneration: number,
    snapshot: YodaSettingsArchive,
    options: { baseRevision: string | null; force: boolean }
  ): Promise<CloudSettingsSnapshot> {
    return lovStudioApiClient.request<CloudSettingsSnapshot>(
      '/api/yoda/settings',
      {
        method: 'PUT',
        body: JSON.stringify({
          snapshot,
          baseRevision: options.baseRevision,
          force: options.force,
        }),
      },
      { expectedUserId, expectedGeneration }
    );
  }
}

export const settingsCloudClient = new SettingsCloudClient();
