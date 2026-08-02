export const MOBILE_INPUT_IMAGE_MAX_EDGE = 2048;
export const MOBILE_INPUT_IMAGE_JPEG_QUALITY = 0.8;
export const MOBILE_INPUT_IMAGE_PROCESSING_CONCURRENCY = 2;

export type MobileInputImageResize = {
  height?: number;
  width?: number;
};

export function mobileInputImageResize(
  width: number,
  height: number
): MobileInputImageResize | null {
  if (width <= 0 || height <= 0 || Math.max(width, height) <= MOBILE_INPUT_IMAGE_MAX_EDGE) {
    return null;
  }

  return width >= height
    ? { width: MOBILE_INPUT_IMAGE_MAX_EDGE }
    : { height: MOBILE_INPUT_IMAGE_MAX_EDGE };
}
