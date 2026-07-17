import dreamSkinArt from '@/assets/images/themes/codex-dream-skin.jpg';
import dreamBloomArt from '@/assets/images/themes/dream-bloom.svg';
import dreamClearArt from '@/assets/images/themes/dream-clear.svg';
import dreamCosmosArt from '@/assets/images/themes/dream-cosmos.svg';
import dreamFortuneArt from '@/assets/images/themes/dream-fortune.svg';
import dreamGoldArt from '@/assets/images/themes/dream-gold.svg';
import dreamPurpleArt from '@/assets/images/themes/dream-purple.svg';
import dreamScifiArt from '@/assets/images/themes/dream-scifi.svg';
import dreamVirtualArt from '@/assets/images/themes/dream-virtual.svg';
import type { DREAM_SKIN_BUILTIN_IMAGES } from '@shared/custom-theme';

const dreamSkinObjectUrls = new Map<string, string>();

export const DREAM_SKIN_ASSETS: Record<(typeof DREAM_SKIN_BUILTIN_IMAGES)[number], string> = {
  'builtin:dream-bloom': dreamBloomArt,
  'builtin:dream-portal': dreamSkinArt,
  'builtin:dream-fortune': dreamFortuneArt,
  'builtin:dream-scifi': dreamScifiArt,
  'builtin:dream-clear': dreamClearArt,
  'builtin:dream-cosmos': dreamCosmosArt,
  'builtin:dream-purple': dreamPurpleArt,
  'builtin:dream-virtual': dreamVirtualArt,
  'builtin:dream-gold': dreamGoldArt,
};

export function resolveDreamSkinAsset(image: string): string {
  const bundledAsset = DREAM_SKIN_ASSETS[image as keyof typeof DREAM_SKIN_ASSETS];
  if (bundledAsset) return bundledAsset;
  if (!shouldUseObjectUrl(image)) return image;

  const cached = dreamSkinObjectUrls.get(image);
  if (cached) return cached;

  const objectUrl = createImageObjectUrl(image);
  if (!objectUrl) return image;
  dreamSkinObjectUrls.set(image, objectUrl);
  return objectUrl;
}

export function releaseDreamSkinAsset(image: string): void {
  const objectUrl = dreamSkinObjectUrls.get(image);
  if (!objectUrl) return;
  globalThis.URL.revokeObjectURL(objectUrl);
  dreamSkinObjectUrls.delete(image);
}

export function releaseAllDreamSkinAssets(): void {
  for (const objectUrl of dreamSkinObjectUrls.values()) {
    globalThis.URL.revokeObjectURL(objectUrl);
  }
  dreamSkinObjectUrls.clear();
}

/**
 * Produces a CSS-safe image value for both emitted asset URLs and Vite's
 * inlined SVG data URLs. The latter contain quotes, spaces, and angle brackets
 * that invalidate an unquoted `url(...)` declaration.
 */
export function dreamSkinBackgroundImage(image: string): string {
  return `url(${JSON.stringify(resolveDreamSkinAsset(image))})`;
}

function shouldUseObjectUrl(image: string): boolean {
  return (
    image.startsWith('data:image/') &&
    image.slice(0, 64).includes(';base64,') &&
    typeof globalThis.URL?.createObjectURL === 'function' &&
    typeof globalThis.atob === 'function'
  );
}

function createImageObjectUrl(dataUrl: string): string | null {
  const separator = dataUrl.indexOf(',');
  if (separator === -1) return null;
  const header = dataUrl.slice(5, separator);
  const mimeType = header.slice(0, header.indexOf(';'));
  if (!mimeType.startsWith('image/')) return null;

  try {
    const binary = globalThis.atob(dataUrl.slice(separator + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return globalThis.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  } catch {
    return null;
  }
}
