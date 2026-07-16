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
  return DREAM_SKIN_ASSETS[image as keyof typeof DREAM_SKIN_ASSETS] ?? image;
}

/**
 * Produces a CSS-safe image value for both emitted asset URLs and Vite's
 * inlined SVG data URLs. The latter contain quotes, spaces, and angle brackets
 * that invalidate an unquoted `url(...)` declaration.
 */
export function dreamSkinBackgroundImage(image: string): string {
  return `url(${JSON.stringify(resolveDreamSkinAsset(image))})`;
}
