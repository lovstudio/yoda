import { createRPCController } from '@shared/ipc/rpc';
import type { SettingsSyncMode } from '@shared/settings-sync';
import { settingsSyncService } from './service';

export const settingsSyncController = createRPCController({
  getStatus: () => settingsSyncService.getStatus(),
  setAutoSyncEnabled: (enabled: boolean) => settingsSyncService.setAutoSyncEnabled(enabled),
  exportToFile: (rendererStorage: Record<string, string>) =>
    settingsSyncService.exportToFile(rendererStorage),
  importFromFile: () => settingsSyncService.importFromFile(),
  sync: (rendererStorage: Record<string, string>, mode: SettingsSyncMode) =>
    settingsSyncService.sync(rendererStorage, mode),
  restartApp: () => settingsSyncService.restartApp(),
});
