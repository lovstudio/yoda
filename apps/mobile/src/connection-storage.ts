import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  DEFAULT_MOBILE_CONNECTION_SETTINGS,
  parseConnectionSettings,
  type MobileConnectionSettings,
} from './connection-endpoints';

const STORAGE_KEY = 'yoda.mobile.connection.v1';
const SECURE_STORAGE_KEY = 'yoda.mobile.connection.secure.v1';
const SETTINGS_SECURE_STORAGE_KEY = 'yoda.mobile.connection.secure.v2';
const SETTINGS_STORAGE_KEY = 'yoda.mobile.connection.v2';

async function secureStorageAvailable(): Promise<boolean> {
  return Platform.OS !== 'web' && (await SecureStore.isAvailableAsync());
}

async function readRaw(
  secureKey: string,
  plainKey: string,
  secure: boolean
): Promise<string | null> {
  if (secure) {
    const stored = await SecureStore.getItemAsync(secureKey);
    if (stored) return stored;
  }
  return AsyncStorage.getItem(plainKey);
}

export async function loadConnectionSettings(): Promise<MobileConnectionSettings> {
  const secure = await secureStorageAvailable();
  if (Platform.OS !== 'web' && !secure) return DEFAULT_MOBILE_CONNECTION_SETTINGS;

  const current = await readRaw(SETTINGS_SECURE_STORAGE_KEY, SETTINGS_STORAGE_KEY, secure);
  const parsed = current ? parseConnectionSettings(current) : null;
  if (parsed) return parsed;

  const legacy = await readRaw(SECURE_STORAGE_KEY, STORAGE_KEY, secure);
  const migrated = legacy ? parseConnectionSettings(legacy) : null;
  if (!migrated) return DEFAULT_MOBILE_CONNECTION_SETTINGS;
  await saveConnectionSettings(migrated);
  return migrated;
}

export async function saveConnectionSettings(settings: MobileConnectionSettings): Promise<void> {
  const serialized = JSON.stringify(settings);
  if (await secureStorageAvailable()) {
    await SecureStore.setItemAsync(SETTINGS_SECURE_STORAGE_KEY, serialized);
    await AsyncStorage.removeItem(SETTINGS_STORAGE_KEY);
    await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (Platform.OS !== 'web') {
    throw new Error('Secure credential storage is unavailable on this device');
  }
  await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
}

export async function clearConnectionSettings(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEY, SETTINGS_STORAGE_KEY]);
  if (!(await secureStorageAvailable())) return;
  await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(SETTINGS_SECURE_STORAGE_KEY).catch(() => undefined);
}
