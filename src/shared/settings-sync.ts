import type { AppSettings, RuntimeCustomConfig } from './app-settings';

export const YODA_SETTINGS_ARCHIVE_KIND = 'yoda-settings' as const;
export const YODA_SETTINGS_ARCHIVE_VERSION = 1 as const;

export type PortableAppSettings = Partial<AppSettings>;

export type YodaSettingsArchive = {
  kind: typeof YODA_SETTINGS_ARCHIVE_KIND;
  version: typeof YODA_SETTINGS_ARCHIVE_VERSION;
  appVersion: string;
  exportedAt: string;
  data: {
    appSettings: PortableAppSettings;
    runtimeConfigs: Record<string, RuntimeCustomConfig>;
    viewState: Record<string, unknown>;
    rendererStorage: Record<string, string>;
  };
};

export type SettingsSyncMode = 'auto' | 'upload' | 'download';

export type SettingsSyncResult = {
  status: 'synced' | 'uploaded' | 'downloaded' | 'conflict' | 'no-cloud-settings';
  cloudUpdatedAt: string | null;
  lastSyncedAt: string | null;
  rendererStorage?: Record<string, string>;
};

export type SettingsSyncStatus = {
  signedIn: boolean;
  autoSyncEnabled: boolean;
  lastSyncedAt: string | null;
  cloudUpdatedAt: string | null;
};

export type SettingsFileResult =
  | { status: 'cancelled' }
  | { status: 'exported'; filePath: string }
  | { status: 'imported'; rendererStorage: Record<string, string> };
