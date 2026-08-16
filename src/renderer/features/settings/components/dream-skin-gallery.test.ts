import { describe, expect, it } from 'vitest';
import { DREAM_SKIN_GALLERY } from './dream-skin-gallery';

describe('dream skin gallery', () => {
  it('offers the featured skins without duplicate artwork', () => {
    expect(DREAM_SKIN_GALLERY.map(({ value }) => value)).toEqual([
      'ydream-arina',
      'ydream-panther',
    ]);

    expect(new Set(DREAM_SKIN_GALLERY.map(({ image }) => image)).size).toBe(
      DREAM_SKIN_GALLERY.length
    );
  });
});
