import { describe, expect, it } from 'vitest';
import {
  clampMobileCropRect,
  initialMobileCropRect,
  mobileCropRectToImageRect,
  moveMobileCropRect,
  resizeMobileCropRect,
} from '../../apps/mobile/src/input-image-editing';

describe('mobile image editing geometry', () => {
  it('starts with a visible crop selection without committing a crop', () => {
    expect(initialMobileCropRect(300, 200)).toEqual({
      height: 160,
      width: 240,
      x: 30,
      y: 20,
    });
  });

  it('keeps a moved crop rectangle inside the displayed image', () => {
    expect(
      moveMobileCropRect({ height: 80, width: 120, x: 20, y: 30 }, 200, -100, 300, 200)
    ).toEqual({ height: 80, width: 120, x: 180, y: 0 });
  });

  it('resizes from a corner without crossing the opposite edge', () => {
    expect(
      resizeMobileCropRect({ height: 120, width: 160, x: 40, y: 30 }, 'top-left', -80, 50, 300, 240)
    ).toEqual({ height: 70, width: 200, x: 0, y: 80 });
  });

  it('clamps crop rectangles and maps display coordinates to source pixels', () => {
    const crop = clampMobileCropRect({ height: 140, width: 220, x: -20, y: 90 }, 200, 160);
    expect(crop).toEqual({ height: 140, width: 200, x: 0, y: 20 });
    expect(mobileCropRectToImageRect(crop, 200, 160, 1000, 800)).toEqual({
      height: 700,
      originX: 0,
      originY: 100,
      width: 1000,
    });
  });
});
