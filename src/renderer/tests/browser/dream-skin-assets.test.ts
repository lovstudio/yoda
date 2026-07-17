import { afterEach, describe, expect, it } from 'vitest';
import {
  dreamSkinBackgroundImage,
  releaseAllDreamSkinAssets,
  releaseDreamSkinAsset,
  resolveDreamSkinAsset,
} from '@renderer/lib/providers/dream-skin-assets';

afterEach(() => {
  document.documentElement.style.removeProperty('--dream-skin-test-art');
  releaseAllDreamSkinAssets();
});

describe('Dream Skin image assets', () => {
  it('uses a Blob URL even for compact image data URLs', () => {
    const image = 'data:image/png;base64,aA==';

    expect(resolveDreamSkinAsset(image)).toMatch(/^blob:/);
  });

  it('uses a cached Blob URL instead of copying image data into CSS', () => {
    const image = `data:image/png;base64,${'A'.repeat(16_384)}`;
    const firstUrl = resolveDreamSkinAsset(image);
    const secondUrl = resolveDreamSkinAsset(image);
    const backgroundImage = dreamSkinBackgroundImage(image);

    expect(firstUrl).toMatch(/^blob:/);
    expect(secondUrl).toBe(firstUrl);
    expect(backgroundImage).toContain(firstUrl);

    const root = document.documentElement;
    root.style.setProperty('--dream-skin-test-art', backgroundImage);
    expect(root.style.getPropertyValue('--dream-skin-test-art')).toContain(firstUrl);
  });

  it('revokes an image Blob URL so a future render creates a fresh one', () => {
    const image = 'data:image/png;base64,aA==';
    const firstUrl = resolveDreamSkinAsset(image);

    releaseDreamSkinAsset(image);

    expect(resolveDreamSkinAsset(image)).toMatch(/^blob:/);
    expect(resolveDreamSkinAsset(image)).not.toBe(firstUrl);
  });
});
