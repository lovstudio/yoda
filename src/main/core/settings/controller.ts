import { createRPCController } from '@/shared/ipc/rpc';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { appSettingsService, type AppSettings, type AppSettingsKey } from './settings-service';

async function syncTerminalPtySettings(): Promise<void> {
  ptySessionRegistry.setScrollbackLines((await appSettingsService.get('terminal')).scrollbackLines);
}

export const appSettingsController = createRPCController({
  get: <T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> => appSettingsService.get(key),

  getAll: (): Promise<AppSettings> => appSettingsService.getAll(),

  getWithMeta: <T extends AppSettingsKey>(
    key: T
  ): Promise<{
    value: AppSettings[T];
    defaults: AppSettings[T];
    overrides: Partial<AppSettings[T]>;
  }> => appSettingsService.getWithMeta(key),

  update: <T extends AppSettingsKey>(
    key: T,
    value: AppSettings[T] | Partial<AppSettings[T]>
  ): Promise<void> => updateSetting(key, value),

  reset: <T extends AppSettingsKey>(key: T): Promise<void> => resetSetting(key),

  resetField: <T extends AppSettingsKey>(key: T, field: string): Promise<void> =>
    resetSettingField(key, field as keyof AppSettings[T]),
});

async function updateSetting<T extends AppSettingsKey>(
  key: T,
  value: AppSettings[T] | Partial<AppSettings[T]>
): Promise<void> {
  await appSettingsService.update(key, value);
  if (key === 'terminal') await syncTerminalPtySettings();
}

async function resetSetting<T extends AppSettingsKey>(key: T): Promise<void> {
  await appSettingsService.reset(key);
  if (key === 'terminal') await syncTerminalPtySettings();
}

async function resetSettingField<T extends AppSettingsKey>(
  key: T,
  field: keyof AppSettings[T]
): Promise<void> {
  await appSettingsService.resetField(key, field);
  if (key === 'terminal') await syncTerminalPtySettings();
}
