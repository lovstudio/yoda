import { describe, expect, it } from 'vitest';
import {
  MOBILE_INPUT_IMAGE_JPEG_QUALITY,
  MOBILE_INPUT_IMAGE_MAX_EDGE,
  MOBILE_INPUT_IMAGE_PROCESSING_CONCURRENCY,
  mobileInputImageResize,
} from '../../apps/mobile/src/input-image-policy';

describe('mobile input image policy', () => {
  it('keeps images within the maximum edge unchanged', () => {
    expect(mobileInputImageResize(2048, 1536)).toBeNull();
    expect(mobileInputImageResize(1024, 2048)).toBeNull();
  });

  it('limits the long edge while preserving the aspect ratio in the native renderer', () => {
    expect(mobileInputImageResize(4032, 3024)).toEqual({ width: MOBILE_INPUT_IMAGE_MAX_EDGE });
    expect(mobileInputImageResize(3024, 4032)).toEqual({ height: MOBILE_INPUT_IMAGE_MAX_EDGE });
    expect(mobileInputImageResize(4000, 4000)).toEqual({ width: MOBILE_INPUT_IMAGE_MAX_EDGE });
  });

  it('ignores invalid source dimensions and uses bounded processing defaults', () => {
    expect(mobileInputImageResize(0, 3000)).toBeNull();
    expect(MOBILE_INPUT_IMAGE_JPEG_QUALITY).toBe(0.8);
    expect(MOBILE_INPUT_IMAGE_PROCESSING_CONCURRENCY).toBe(2);
  });
});
