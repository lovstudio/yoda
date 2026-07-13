import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { MobileConnection } from './api-client';

const STORAGE_KEY = 'yoda.mobile.connection.v1';
const SECURE_STORAGE_KEY = 'yoda.mobile.connection.secure.v1';

async function secureStorageAvailable(): Promise<boolean> {
  return Platform.OS !== 'web' && (await SecureStore.isAvailableAsync());
}

export async function loadConnection(): Promise<MobileConnection | null> {
  const secure = await secureStorageAvailable();
  if (Platform.OS !== 'web' && !secure) return null;
  const raw = secure
    ? ((await SecureStore.getItemAsync(SECURE_STORAGE_KEY)) ??
      (await AsyncStorage.getItem(STORAGE_KEY)))
    : await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<MobileConnection>;
    if (!parsed.baseUrl || !parsed.token) return null;
    const connection = {
      baseUrl: parsed.baseUrl,
      token: parsed.token,
    };
    if (secure && !(await SecureStore.getItemAsync(SECURE_STORAGE_KEY))) {
      await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(connection));
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    return connection;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: MobileConnection): Promise<void> {
  if (await secureStorageAvailable()) {
    await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(connection));
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (Platform.OS !== 'web') {
    throw new Error('Secure credential storage is unavailable on this device');
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export async function clearConnection(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  if (await secureStorageAvailable()) await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
}
