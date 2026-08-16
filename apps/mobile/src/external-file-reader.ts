import { MOBILE_SESSION_INPUT_MAX_CHARS } from '@lovstudio/yoda-protocol/mobile-api';
import { File } from 'expo-file-system';
import { getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { MobileExternalFile } from './external-file-input';

const MAX_EXTERNAL_TEXT_BYTES = 1 * 1024 * 1024;

/** Read a text document shared into the app, keeping the prompt bounded and editable. */
export async function readMobileExternalTextFile(file: MobileExternalFile): Promise<string> {
  if (file.kind !== 'text') throw new Error('当前仅支持读取图片和文本文件。');

  const info = await getInfoAsync(file.uri);
  if (!info.exists || info.isDirectory) throw new Error('共享文件已不可用。');
  if (typeof info.size === 'number' && info.size > MAX_EXTERNAL_TEXT_BYTES) {
    throw new Error('共享文本文件超过 1 MB。');
  }

  const content = (await readAsStringAsync(file.uri, { encoding: 'utf8' })).replace(/^\uFEFF/, '');
  if (!content.trim()) throw new Error('共享文本文件为空。');
  return content.slice(0, MOBILE_SESSION_INPUT_MAX_CHARS);
}

/** Resolve Android content URIs whose display name does not include an extension. */
export async function resolveMobileExternalFile(
  file: MobileExternalFile
): Promise<MobileExternalFile> {
  if (file.kind !== 'unsupported' || Platform.OS !== 'android') return file;

  try {
    const mimeType = new File(file.uri).type.toLocaleLowerCase();
    if (mimeType.startsWith('image/')) return { ...file, kind: 'image' };
    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/javascript' ||
      mimeType === 'application/xml'
    ) {
      return { ...file, kind: 'text' };
    }
  } catch {
    // Keep the original unsupported classification so the caller can explain it.
  }

  return file;
}
