import type {
  SettingsFileResult,
  SettingsSyncMode,
  SettingsSyncResult,
} from '@shared/settings-sync';
import { rpc } from '@renderer/lib/ipc';

const PORTABLE_STORAGE_KEYS = new Set([
  'yoda-theme',
  'yoda:language',
  'yoda:terminal-ime-native-punctuation',
  'yoda.aiLab.engine',
  'yoda.skillsLayout',
  'yoda:projects-overview:visible-columns',
]);

const PORTABLE_STORAGE_PREFIXES = [
  'yoda:agent-account:expanded:',
  'react-resizable-panels:workspace-outer',
];

export function isPortableRendererStorageKey(key: string): boolean {
  return (
    PORTABLE_STORAGE_KEYS.has(key) ||
    PORTABLE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function collectPortableRendererStorage(
  storage: Pick<Storage, 'key' | 'length' | 'getItem'> = window.localStorage
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isPortableRendererStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

export function applyPortableRendererStorage(
  values: Record<string, string>,
  storage: Pick<Storage, 'key' | 'length' | 'removeItem' | 'setItem'> = window.localStorage
): void {
  const existingKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isPortableRendererStorageKey(key)) existingKeys.push(key);
  }
  existingKeys.forEach((key) => storage.removeItem(key));
  for (const [key, value] of Object.entries(values)) {
    if (isPortableRendererStorageKey(key)) storage.setItem(key, value);
  }
}

export async function exportSettingsFile(): Promise<SettingsFileResult> {
  return rpc.settingsSync.exportToFile(collectPortableRendererStorage());
}

export async function importSettingsFile(): Promise<SettingsFileResult> {
  const result = await rpc.settingsSync.importFromFile();
  if (result.status === 'imported') applyPortableRendererStorage(result.rendererStorage);
  return result;
}

export async function syncSettings(mode: SettingsSyncMode): Promise<SettingsSyncResult> {
  const result = await rpc.settingsSync.sync(collectPortableRendererStorage(), mode);
  if (result.status === 'downloaded' && result.rendererStorage) {
    applyPortableRendererStorage(result.rendererStorage);
  }
  return result;
}

export function restartAfterSettingsRestore(): Promise<void> {
  return rpc.settingsSync.restartApp();
}
