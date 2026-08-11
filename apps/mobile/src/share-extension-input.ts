import * as Clipboard from 'expo-clipboard';
import type { MobileExternalFile } from './external-file-input';
import { importMobileInputImage } from './input-media';
import type { MobileImageDraft } from './input-upload';

const MOBILE_SHARE_MARKER_PREFIX = 'YODA_MOBILE_SHARE|';

function expectedMarker(file: MobileExternalFile): string {
  if (file.source !== 'share-extension' || !file.shareToken) {
    throw new Error('共享内容标记已失效，请从系统分享面板重新发送。');
  }
  return `${MOBILE_SHARE_MARKER_PREFIX}${file.shareToken}|${file.kind}`;
}

async function readShareMarker(file: MobileExternalFile): Promise<string> {
  const value = await Clipboard.getStringAsync();
  const marker = expectedMarker(file);
  if (value === marker) return '';
  if (value.startsWith(`${marker}\n`)) return value.slice(marker.length + 1);
  throw new Error('共享内容已过期，请从系统分享面板重新发送。');
}

/** Read the text payload written by the iOS Share Extension. */
export async function readMobileShareExtensionText(file: MobileExternalFile): Promise<string> {
  if (file.kind !== 'text') throw new Error('当前共享内容不是文本。');
  const content = await readShareMarker(file);
  if (!content.trim()) throw new Error('共享文本为空。');
  return content;
}

/** Read the image payload written by the iOS Share Extension. */
export async function readMobileShareExtensionImage(
  file: MobileExternalFile
): Promise<MobileImageDraft> {
  if (file.kind !== 'image') throw new Error('当前共享内容不是图片。');
  await readShareMarker(file);
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image) throw new Error('共享图片已不可用，请从系统分享面板重新发送。');
  return importMobileInputImage(image.data, file.name);
}
