import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@shared/custom-theme';
import {
  extractDreamSkinPaletteFromPixels,
  humanizeDreamSkinFileName,
  suggestDreamSkinDecoration,
  updateDreamSkinAccent,
} from './dream-skin-palette';

function pixels(colors: Array<[number, number, number]>, repeats: number[]): Uint8ClampedArray {
  const values: number[] = [];
  colors.forEach((color, index) => {
    for (let count = 0; count < (repeats[index] ?? 1); count += 1) {
      values.push(...color, 255);
    }
  });
  return new Uint8ClampedArray(values);
}

describe('Dream Skin palette extraction', () => {
  it('turns a fiery low-luminance image into a readable dark IDE palette', () => {
    const analysis = extractDreamSkinPaletteFromPixels(
      pixels(
        [
          [14, 5, 3],
          [198, 42, 12],
          [248, 170, 35],
        ],
        [80, 24, 12]
      )
    );

    expect(analysis.mode).toBe('dark');
    expect(suggestDreamSkinDecoration(analysis.accent)).toBe('embers');
    expect(
      getContrastRatio(
        analysis.colors.primaryButtonForeground,
        analysis.colors.primaryButtonBackground
      )
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(analysis.colors.foreground, analysis.colors.background)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a bright pastel image in a light shell', () => {
    const analysis = extractDreamSkinPaletteFromPixels(
      pixels(
        [
          [250, 235, 239],
          [242, 196, 208],
          [255, 248, 245],
        ],
        [40, 18, 32]
      )
    );

    expect(analysis.mode).toBe('light');
    expect(
      getContrastRatio(analysis.colors.foreground, analysis.colors.background)
    ).toBeGreaterThan(7);
  });

  it('cleans camera and content pipeline prefixes from imported file names', () => {
    expect(humanizeDreamSkinFileName('20260706_ent_kung-fu-soccer.png')).toBe('Kung Fu Soccer');
    expect(humanizeDreamSkinFileName('IMG_桥本有菜_玫瑰.webp')).toBe('桥本有菜 玫瑰');
  });

  it('updates the accent family without lowering button contrast', () => {
    const analysis = extractDreamSkinPaletteFromPixels(pixels([[25, 30, 38]], [20]));
    const colors = updateDreamSkinAccent(analysis.colors, '#6f42c1', 'dark');

    expect(colors.primaryButtonBackground).not.toBe('#6f42c1');
    expect(
      getContrastRatio(colors.primaryButtonForeground, colors.primaryButtonBackground)
    ).toBeGreaterThanOrEqual(4.5);
  });
});
