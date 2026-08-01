import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { MOBILE_INPUT_ATTACHMENT_MAX_BYTES } from '../../../src/shared/mobile-api';
import {
  MOBILE_INPUT_IMAGE_JPEG_QUALITY,
  MOBILE_INPUT_IMAGE_PROCESSING_CONCURRENCY,
  mobileInputImageResize,
} from './input-image-policy';
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

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  const transformNext = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => transformNext())
  );
  return results;
}

async function prepareMobileInputImage(
  asset: ImagePicker.ImagePickerAsset,
  index: number
): Promise<MobileImageDraft> {
  const context = ImageManipulator.manipulate(asset.uri);
  const resize = mobileInputImageResize(asset.width, asset.height);
  if (resize) context.resize(resize);

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    base64: true,
    compress: MOBILE_INPUT_IMAGE_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const base64 = result.base64;
  if (!base64) throw new Error('The selected image could not be compressed for upload.');

  const sizeBytes = base64ByteLength(base64);
  if (sizeBytes > MOBILE_INPUT_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `${asset.fileName || 'This image'} is larger than ${Math.floor(MOBILE_INPUT_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB after compression.`
    );
  }

  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    base64,
    height: result.height,
    mimeType: 'image/jpeg',
    name: jpegName(asset.fileName, index),
    sizeBytes,
    uri: result.uri,
    width: result.width,
  };
}

export async function pickMobileInputImages(): Promise<MobileImageDraft[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    base64: false,
    mediaTypes: ['images'],
    orderedSelection: true,
    quality: 1,
    selectionLimit: 0,
  });
  if (result.canceled) return [];

  return mapWithConcurrency(
    result.assets,
    MOBILE_INPUT_IMAGE_PROCESSING_CONCURRENCY,
    prepareMobileInputImage
  );
}
