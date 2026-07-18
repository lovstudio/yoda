import {
  AI_LAB_APP_IMAGE_MODEL,
  isImageEditRequest,
  type AiLabImageEditInput,
  type AiLabImageEditQuality,
  type AiLabImageEditResult,
  type AiLabImageEditSize,
} from '@shared/ai-lab-bridge';

const MAX_INPUT_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 30 * 1024 * 1024;

export type NormalizedAiLabImageEditInput = {
  appId: string;
  imageDataUrl: string;
  prompt: string;
  size: AiLabImageEditSize;
  quality: AiLabImageEditQuality;
};

export type AiLabImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export function normalizeAiLabImageEditInput(input: AiLabImageEditInput): {
  input: NormalizedAiLabImageEditInput;
  source: Buffer;
  sourceMimeType: AiLabImageMimeType;
} {
  if (!input || typeof input !== 'object') throw new Error('Invalid image edit request.');
  if (typeof input.appId !== 'string' || input.appId.trim().length === 0) {
    throw new Error('Invalid AI Lab app.');
  }
  if (!isImageEditRequest(input)) throw new Error('Invalid image edit request.');

  const { source, mimeType: sourceMimeType } = decodeImageDataUrl(input.imageDataUrl);
  if (source.length > MAX_INPUT_IMAGE_BYTES) {
    throw new Error('The source image exceeds the 15 MB limit.');
  }

  return {
    input: {
      appId: input.appId.trim(),
      imageDataUrl: input.imageDataUrl,
      prompt: input.prompt.trim(),
      size: input.size ?? '1024x1024',
      quality: input.quality ?? 'high',
    },
    source,
    sourceMimeType,
  };
}

export function toAiLabImageEditResult(buffer: Buffer): AiLabImageEditResult {
  if (buffer.length === 0) throw new Error('The generated image is empty.');
  if (!hasPngSignature(buffer)) throw new Error('The generated image is not a valid PNG.');
  if (buffer.length > MAX_OUTPUT_IMAGE_BYTES) {
    throw new Error('The generated image exceeds the 30 MB limit.');
  }
  return {
    imageDataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    model: AI_LAB_APP_IMAGE_MODEL,
  };
}

function decodeImageDataUrl(dataUrl: string): {
  source: Buffer;
  mimeType: AiLabImageMimeType;
} {
  const commaIndex = dataUrl.indexOf(',');
  const prefix = dataUrl.slice(0, commaIndex).toLowerCase();
  const encoded = dataUrl.slice(commaIndex + 1);
  if (
    commaIndex < 0 ||
    !['data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'].includes(
      prefix
    ) ||
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    /[^a-z0-9+/=]/i.test(encoded) ||
    !/^[a-z0-9+/]+={0,2}$/i.test(encoded)
  ) {
    throw new Error('The source image data is invalid.');
  }
  const source = Buffer.from(encoded, 'base64');
  const matchesDeclaredType =
    (prefix === 'data:image/png;base64' && hasPngSignature(source)) ||
    (prefix === 'data:image/jpeg;base64' && hasJpegSignature(source)) ||
    (prefix === 'data:image/webp;base64' && hasWebpSignature(source));
  if (!matchesDeclaredType) throw new Error('The source image data is invalid.');
  return { source, mimeType: prefix.slice(5, -7) as AiLabImageMimeType };
}

function hasPngSignature(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
}

function hasJpegSignature(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasWebpSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
