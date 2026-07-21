export const AI_LAB_BRIDGE_CHANNEL = 'yoda:ai-lab-host:v1';
export const AI_LAB_IMAGE_EDIT_METHOD = 'images.edit';
export const AI_LAB_COPY_LAST_ERROR_METHOD = 'errors.copyLast';
export const AI_LAB_APP_IMAGE_MODEL = 'openai/gpt-image-2';
export const AI_LAB_IMAGE_EDIT_MAX_PROMPT_CHARS = 4_000;
export const AI_LAB_IMAGE_EDIT_MAX_DATA_URL_CHARS = 21_000_000;
export const AI_LAB_USER_NOTE_MAX_CHARS = 800;

export const AI_LAB_IMAGE_EDIT_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type AiLabImageEditSize = (typeof AI_LAB_IMAGE_EDIT_SIZES)[number];

export const AI_LAB_IMAGE_EDIT_QUALITIES = ['auto', 'medium', 'high'] as const;
export type AiLabImageEditQuality = (typeof AI_LAB_IMAGE_EDIT_QUALITIES)[number];

export type AiLabImageEditRequest = {
  imageDataUrl: string;
  prompt: string;
  size?: AiLabImageEditSize;
  quality?: AiLabImageEditQuality;
};

export type AiLabImageEditInput = AiLabImageEditRequest & {
  appId: string;
  userNote?: string;
};

export type AiLabRegenerateImageInput = {
  appId: string;
  id: string;
  userNote?: string;
};

export type AiLabImageEditResult = {
  imageDataUrl: string;
  model: typeof AI_LAB_APP_IMAGE_MODEL;
  historyId?: string;
  createdAt?: string;
};

export type AiLabAppImageEditHistoryItem = {
  id: string;
  appId: string;
  prompt: string;
  model: typeof AI_LAB_APP_IMAGE_MODEL;
  createdAt: string;
  thumbnailDataUrl: string;
};

export type AiLabAppImageEditHistoryImage = {
  id: string;
  imageDataUrl: string;
  model: typeof AI_LAB_APP_IMAGE_MODEL;
  createdAt: string;
};

export type AiLabBridgeImageEditRequest = {
  channel: typeof AI_LAB_BRIDGE_CHANNEL;
  kind: 'request';
  requestId: string;
  method: typeof AI_LAB_IMAGE_EDIT_METHOD;
  payload: AiLabImageEditRequest;
};

export type AiLabBridgeCopyLastErrorRequest = {
  channel: typeof AI_LAB_BRIDGE_CHANNEL;
  kind: 'request';
  requestId: string;
  method: typeof AI_LAB_COPY_LAST_ERROR_METHOD;
  payload: Record<string, never>;
};

export type AiLabBridgeRequest = AiLabBridgeImageEditRequest | AiLabBridgeCopyLastErrorRequest;

export type AiLabCopyLastErrorResult = { copied: true };

export type AiLabBridgeResponse = {
  channel: typeof AI_LAB_BRIDGE_CHANNEL;
  kind: 'response';
  requestId: string;
} & (
  | { ok: true; result: AiLabImageEditResult | AiLabCopyLastErrorResult }
  | { ok: false; error: string }
);

export function parseAiLabBridgeRequest(value: unknown): AiLabBridgeRequest | null {
  if (!isRecord(value)) return null;
  if (
    value.channel !== AI_LAB_BRIDGE_CHANNEL ||
    value.kind !== 'request' ||
    !isRequestId(value.requestId)
  ) {
    return null;
  }
  if (
    value.method === AI_LAB_COPY_LAST_ERROR_METHOD &&
    isRecord(value.payload) &&
    Object.keys(value.payload).length === 0
  ) {
    return {
      channel: AI_LAB_BRIDGE_CHANNEL,
      kind: 'request',
      requestId: value.requestId,
      method: AI_LAB_COPY_LAST_ERROR_METHOD,
      payload: {},
    };
  }
  if (value.method !== AI_LAB_IMAGE_EDIT_METHOD || !isImageEditRequest(value.payload)) return null;
  const payload = value.payload as unknown as AiLabImageEditRequest;
  return {
    channel: AI_LAB_BRIDGE_CHANNEL,
    kind: 'request',
    requestId: value.requestId,
    method: AI_LAB_IMAGE_EDIT_METHOD,
    payload: {
      imageDataUrl: payload.imageDataUrl,
      prompt: payload.prompt,
      ...(payload.size ? { size: payload.size } : {}),
      ...(payload.quality ? { quality: payload.quality } : {}),
    },
  };
}

export function isImageEditRequest(value: unknown): value is AiLabImageEditRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.imageDataUrl === 'string' &&
    value.imageDataUrl.length > 0 &&
    value.imageDataUrl.length <= AI_LAB_IMAGE_EDIT_MAX_DATA_URL_CHARS &&
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(value.imageDataUrl) &&
    typeof value.prompt === 'string' &&
    value.prompt.trim().length > 0 &&
    value.prompt.length <= AI_LAB_IMAGE_EDIT_MAX_PROMPT_CHARS &&
    (value.size === undefined || isImageEditSize(value.size)) &&
    (value.quality === undefined || isImageEditQuality(value.quality))
  );
}

export function isImageEditSize(value: unknown): value is AiLabImageEditSize {
  return AI_LAB_IMAGE_EDIT_SIZES.some((size) => size === value);
}

export function isImageEditQuality(value: unknown): value is AiLabImageEditQuality {
  return AI_LAB_IMAGE_EDIT_QUALITIES.some((quality) => quality === value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
