import * as ImagePicker from 'expo-image-picker';
import { MOBILE_INPUT_ATTACHMENT_MAX_BYTES } from '../../../src/shared/mobile-api';
import type { MobileImageDraft } from './input-upload';

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function jpegName(fileName: string | null | undefined, index: number): string {
  const source = fileName?.trim() || `mobile-image-${index + 1}`;
  const stem = source
    .replace(/\.[^.]+$/, '')
    .replace(/[\r\n\0]/g, ' ')
    .trim();
  return `${stem || `mobile-image-${index + 1}`}.jpg`;
}

export async function pickMobileInputImages(): Promise<MobileImageDraft[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    base64: true,
    mediaTypes: ['images'],
    orderedSelection: true,
    quality: 0.86,
    selectionLimit: 0,
  });
  if (result.canceled) return [];

  return result.assets.map((asset, index) => {
    const base64 = asset.base64;
    if (!base64) throw new Error('The selected image could not be prepared for upload.');
    const sizeBytes = base64ByteLength(base64);
    if (sizeBytes > MOBILE_INPUT_ATTACHMENT_MAX_BYTES) {
      throw new Error(
        `${asset.fileName || 'This image'} is larger than ${Math.floor(MOBILE_INPUT_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`
      );
    }
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      base64,
      height: asset.height,
      mimeType: 'image/jpeg',
      name: jpegName(asset.fileName, index),
      sizeBytes,
      uri: asset.uri,
      width: asset.width,
    };
  });
}
