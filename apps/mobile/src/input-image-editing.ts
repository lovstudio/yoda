export type MobileEditorPoint = {
  x: number;
  y: number;
};

export type MobileCropRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type MobileCropHandle = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export type MobileImageRect = {
  height: number;
  originX: number;
  originY: number;
  width: number;
};

const DEFAULT_MIN_CROP_EDGE = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function fullMobileCropRect(canvasWidth: number, canvasHeight: number): MobileCropRect {
  return {
    height: Math.max(canvasHeight, 0),
    width: Math.max(canvasWidth, 0),
    x: 0,
    y: 0,
  };
}

export function clampMobileCropRect(
  rect: MobileCropRect,
  canvasWidth: number,
  canvasHeight: number,
  minimumEdge = DEFAULT_MIN_CROP_EDGE
): MobileCropRect {
  const safeCanvasWidth = Math.max(canvasWidth, 0);
  const safeCanvasHeight = Math.max(canvasHeight, 0);
  const minimumWidth = Math.min(Math.max(minimumEdge, 1), safeCanvasWidth);
  const minimumHeight = Math.min(Math.max(minimumEdge, 1), safeCanvasHeight);
  const width = clamp(rect.width, minimumWidth, safeCanvasWidth);
  const height = clamp(rect.height, minimumHeight, safeCanvasHeight);

  return {
    height,
    width,
    x: clamp(rect.x, 0, safeCanvasWidth - width),
    y: clamp(rect.y, 0, safeCanvasHeight - height),
  };
}

export function moveMobileCropRect(
  start: MobileCropRect,
  deltaX: number,
  deltaY: number,
  canvasWidth: number,
  canvasHeight: number
): MobileCropRect {
  return clampMobileCropRect(
    {
      ...start,
      x: start.x + deltaX,
      y: start.y + deltaY,
    },
    canvasWidth,
    canvasHeight
  );
}

export function resizeMobileCropRect(
  start: MobileCropRect,
  handle: MobileCropHandle,
  deltaX: number,
  deltaY: number,
  canvasWidth: number,
  canvasHeight: number,
  minimumEdge = DEFAULT_MIN_CROP_EDGE
): MobileCropRect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const minimumWidth = Math.min(Math.max(minimumEdge, 1), canvasWidth);
  const minimumHeight = Math.min(Math.max(minimumEdge, 1), canvasHeight);
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle.includes('left')) {
    x = clamp(start.x + deltaX, 0, right - minimumWidth);
    width = right - x;
  } else {
    width = clamp(start.width + deltaX, minimumWidth, canvasWidth - start.x);
  }

  if (handle.includes('top')) {
    y = clamp(start.y + deltaY, 0, bottom - minimumHeight);
    height = bottom - y;
  } else {
    height = clamp(start.height + deltaY, minimumHeight, canvasHeight - start.y);
  }

  return clampMobileCropRect({ height, width, x, y }, canvasWidth, canvasHeight, minimumEdge);
}

export function mobileCropRectToImageRect(
  crop: MobileCropRect,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
): MobileImageRect {
  const safeCrop = clampMobileCropRect(crop, canvasWidth, canvasHeight, 1);
  const scaleX = imageWidth / Math.max(canvasWidth, 1);
  const scaleY = imageHeight / Math.max(canvasHeight, 1);
  const originX = Math.max(0, Math.floor(safeCrop.x * scaleX));
  const originY = Math.max(0, Math.floor(safeCrop.y * scaleY));
  const width = Math.max(1, Math.min(imageWidth - originX, Math.round(safeCrop.width * scaleX)));
  const height = Math.max(1, Math.min(imageHeight - originY, Math.round(safeCrop.height * scaleY)));

  return { height, originX, originY, width };
}

export function mobileEditorPointDistance(a: MobileEditorPoint, b: MobileEditorPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
