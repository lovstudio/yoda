import { readFile, writeFile } from 'node:fs/promises';
import { app, dialog } from 'electron';
import type {
  SettingsFileResult,
  SettingsSyncMode,
  SettingsSyncResult,
  SettingsSyncStatus,
  YodaSettingsArchive,
} from '@shared/settings-sync';
import { LovStudioApiError } from '@main/core/account/services/lovstudio-api-client';
import {
  yodaAccountService,
  type AccountRequestSession,
} from '@main/core/account/services/yoda-account-service';
import { resolveAppVersion } from '@main/core/app/utils';
import { KV } from '@main/db/kv';
import {
  applySettingsArchive,
  createSettingsArchive,
  parseSettingsArchive,
  settingsArchiveDigest,
} from './archive';
import { settingsCloudClient, type CloudSettingsSnapshot } from './cloud-client';

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

type SyncMetadata = {
  userId: string;
  revision: string;
  digest: string;
  lastSyncedAt: string;
  cloudUpdatedAt: string | null;
};

interface SettingsSyncKV extends Record<string, unknown> {
  autoSyncEnabled: boolean;
  metadata: SyncMetadata;
}

const settingsSyncKV = new KV<SettingsSyncKV>('settings-sync');

function cloudArchive(cloud: CloudSettingsSnapshot): YodaSettingsArchive | null {
  return cloud.snapshot ? parseSettingsArchive(cloud.snapshot) : null;
}

export class SettingsSyncService {
  private syncOperation: { mode: SettingsSyncMode; promise: Promise<SettingsSyncResult> } | null =
    null;

  async getStatus(): Promise<SettingsSyncStatus> {
    const [session, enabled, metadata] = await Promise.all([
      yodaAccountService.getSession(),
      settingsSyncKV.get('autoSyncEnabled'),
      settingsSyncKV.get('metadata'),
    ]);
    const currentMetadata = metadata?.userId === session.user?.userId ? metadata : null;
    return {
      signedIn: session.isSignedIn,
      autoSyncEnabled: enabled !== false,
      lastSyncedAt: currentMetadata?.lastSyncedAt ?? null,
      cloudUpdatedAt: currentMetadata?.cloudUpdatedAt ?? null,
    };
  }

  async setAutoSyncEnabled(enabled: boolean): Promise<SettingsSyncStatus> {
    await settingsSyncKV.setStrict('autoSyncEnabled', enabled);
    return this.getStatus();
  }

  async exportToFile(rendererStorage: Record<string, string>): Promise<SettingsFileResult> {
    const appVersion = await resolveAppVersion();
    const archive = await createSettingsArchive(appVersion, rendererStorage);
    const defaultPath = `Yoda-settings-${new Date().toISOString().slice(0, 10)}.yoda-settings.json`;
    const selection = await dialog.showSaveDialog({
      title: 'Export Yoda Settings',
      defaultPath,
      filters: [{ name: 'Yoda Settings', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    await writeFile(selection.filePath, `${JSON.stringify(archive, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return { status: 'exported', filePath: selection.filePath };
  }

  async importFromFile(): Promise<SettingsFileResult> {
    const selection = await dialog.showOpenDialog({
      title: 'Import Yoda Settings',
      filters: [{ name: 'Yoda Settings', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const filePath = selection.filePaths[0];
    if (selection.canceled || !filePath) return { status: 'cancelled' };
    const raw = await readFile(filePath, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_ARCHIVE_BYTES) {
      throw new Error('The settings archive is larger than 10 MB.');
    }
    const archive = parseSettingsArchive(JSON.parse(raw) as unknown);
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Import Yoda Settings',
      message: 'Replace this device’s Yoda settings?',
      detail:
        'Interface, shortcuts, Agent and MaaS configuration will be restored. Projects, sessions and credentials are not changed. Yoda will restart after import.',
      buttons: ['Import and Restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return { status: 'cancelled' };
    await applySettingsArchive(archive);
    return { status: 'imported', rendererStorage: archive.data.rendererStorage };
  }

  sync(
    rendererStorage: Record<string, string>,
    mode: SettingsSyncMode
  ): Promise<SettingsSyncResult> {
    if (this.syncOperation?.mode === mode) return this.syncOperation.promise;
    if (this.syncOperation) {
      return this.syncOperation.promise.then(
        () => this.sync(rendererStorage, mode),
        () => this.sync(rendererStorage, mode)
      );
    }
    const operation = this.syncInternal(rendererStorage, mode).finally(() => {
      if (this.syncOperation?.promise === operation) this.syncOperation = null;
    });
    this.syncOperation = { mode, promise: operation };
    return operation;
  }

  private async syncInternal(
    rendererStorage: Record<string, string>,
    mode: SettingsSyncMode
  ): Promise<SettingsSyncResult> {
    const requestSession = await yodaAccountService.getRequestSession();
    const [appVersion, cloud, storedMetadata] = await Promise.all([
      resolveAppVersion(),
      settingsCloudClient.get(requestSession.userId, requestSession.generation),
      settingsSyncKV.get('metadata'),
    ]);
    const local = await createSettingsArchive(appVersion, rendererStorage);
    const localDigest = settingsArchiveDigest(local);
    const remote = cloudArchive(cloud);
    const metadata = storedMetadata?.userId === requestSession.userId ? storedMetadata : null;

    if (mode === 'download') {
      if (!remote || !cloud.revision) {
        return {
          status: 'no-cloud-settings',
          cloudUpdatedAt: null,
          lastSyncedAt: metadata?.lastSyncedAt ?? null,
        };
      }
      return this.applyCloud(requestSession, cloud, remote);
    }

    if (mode === 'upload') {
      return this.upload(requestSession, local, localDigest, cloud.revision, true);
    }

    if (!remote || !cloud.revision) {
      return this.upload(requestSession, local, localDigest, null, false);
    }
    if (!metadata) return this.applyCloud(requestSession, cloud, remote);

    const localChanged = localDigest !== metadata.digest;
    const cloudChanged = cloud.revision !== metadata.revision;
    if (localChanged && cloudChanged) {
      return {
        status: 'conflict',
        cloudUpdatedAt: cloud.updatedAt,
        lastSyncedAt: metadata.lastSyncedAt,
      };
    }
    if (cloudChanged) return this.applyCloud(requestSession, cloud, remote);
    if (localChanged) {
      return this.upload(requestSession, local, localDigest, metadata.revision, false);
    }
    return {
      status: 'synced',
      cloudUpdatedAt: cloud.updatedAt,
      lastSyncedAt: metadata.lastSyncedAt,
    };
  }

  private async upload(
    requestSession: AccountRequestSession,
    archive: YodaSettingsArchive,
    digest: string,
    baseRevision: string | null,
    force: boolean
  ): Promise<SettingsSyncResult> {
    let cloud: CloudSettingsSnapshot;
    try {
      cloud = await settingsCloudClient.put(
        requestSession.userId,
        requestSession.generation,
        archive,
        {
          baseRevision,
          force,
        }
      );
    } catch (error) {
      if (!force && error instanceof LovStudioApiError && error.status === 409) {
        const metadata = await settingsSyncKV.get('metadata');
        return {
          status: 'conflict',
          cloudUpdatedAt: metadata?.cloudUpdatedAt ?? null,
          lastSyncedAt: metadata?.lastSyncedAt ?? null,
        };
      }
      throw error;
    }
    if (!cloud.revision) throw new Error('Settings sync server returned no revision.');
    this.assertAccountCurrent(requestSession);
    const lastSyncedAt = new Date().toISOString();
    await settingsSyncKV.setStrict('metadata', {
      userId: requestSession.userId,
      revision: cloud.revision,
      digest,
      lastSyncedAt,
      cloudUpdatedAt: cloud.updatedAt,
    });
    return { status: 'uploaded', cloudUpdatedAt: cloud.updatedAt, lastSyncedAt };
  }

  private async applyCloud(
    requestSession: AccountRequestSession,
    cloud: CloudSettingsSnapshot,
    archive: YodaSettingsArchive
  ): Promise<SettingsSyncResult> {
    if (!cloud.revision) throw new Error('Settings sync server returned no revision.');
    this.assertAccountCurrent(requestSession);
    await applySettingsArchive(archive);
    this.assertAccountCurrent(requestSession);
    const lastSyncedAt = new Date().toISOString();
    await settingsSyncKV.setStrict('metadata', {
      userId: requestSession.userId,
      revision: cloud.revision,
      digest: settingsArchiveDigest(archive),
      lastSyncedAt,
      cloudUpdatedAt: cloud.updatedAt,
    });
    return {
      status: 'downloaded',
      cloudUpdatedAt: cloud.updatedAt,
      lastSyncedAt,
      rendererStorage: archive.data.rendererStorage,
    };
  }

  restartApp(): void {
    app.relaunch();
    app.quit();
  }

  private assertAccountCurrent(session: AccountRequestSession): void {
    if (!yodaAccountService.isRequestSessionCurrent(session)) {
      throw new Error('LovStudio account session changed');
    }
  }
}

export const settingsSyncService = new SettingsSyncService();
