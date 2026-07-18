import type { AiLabZenmuxModel } from '@shared/ai-lab';
import {
  AI_LAB_APP_IMAGE_MODEL,
  type AiLabImageEditQuality,
  type AiLabImageEditSize,
} from '@shared/ai-lab-bridge';
import { aiLogService } from '@main/core/ai-logs/ai-log-service';
import type { AiLabImageMimeType } from './app-image-edit';

const REQUEST_TIMEOUT_MS = 180_000;

type ApiErrorBody = {
  error?: string | { message?: string };
  message?: string;
};

type OpenAiImagesResponse = ApiErrorBody & {
  data?: Array<{ b64_json?: string }>;
};

type VertexGenerateContentResponse = ApiErrorBody & {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string } }> };
  }>;
};

/** Restyles a source image through ZenMux's OpenAI-compatible multipart edit protocol. */
export async function editZenmuxImage(input: {
  endpoint: string;
  apiKey: string;
  appId: string;
  prompt: string;
  source: Buffer;
  sourceMimeType: AiLabImageMimeType;
  size: AiLabImageEditSize;
  quality: AiLabImageEditQuality;
}): Promise<Buffer> {
  const url = `${trimTrailingSlash(input.endpoint)}/images/edits`;
  const logId = await aiLogService.start({
    purpose: 'app-image-edit',
    mode: 'api',
    runtime: 'zenmux',
    model: AI_LAB_APP_IMAGE_MODEL,
    command: url,
    prompt: input.prompt,
    metadata: { appId: input.appId, size: input.size, quality: input.quality },
  });
  try {
    const form = new FormData();
    form.set('model', AI_LAB_APP_IMAGE_MODEL);
    form.append(
      'image[]',
      new Blob([Uint8Array.from(input.source)], { type: input.sourceMimeType }),
      sourceFileName(input.sourceMimeType)
    );
    form.set('prompt', input.prompt);
    form.set('input_fidelity', 'high');
    form.set('n', '1');
    form.set('size', input.size);
    form.set('quality', input.quality);
    form.set('output_format', 'png');

    const body = await postMultipart<OpenAiImagesResponse>(url, input.apiKey, form);
    const b64 = body.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64.length === 0) {
      throw new Error('ZenMux Images edit API returned no image data.');
    }
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) throw new Error('ZenMux Images edit API returned an empty image.');
    await aiLogService.finish(logId, {
      status: 'succeeded',
      output: '1 edited image generated.',
    });
    return buffer;
  } catch (error) {
    await aiLogService.finish(logId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generates logo candidates through ZenMux. OpenAI image models use the
 * OpenAI-compatible Images API (supports `n` natively); Google image models
 * are only exposed through ZenMux's Vertex AI protocol, which returns one
 * image per request, so multiple candidates fan out as parallel requests.
 */
export async function generateZenmuxImages(input: {
  endpoint: string;
  apiKey: string;
  model: AiLabZenmuxModel;
  prompt: string;
  count: number;
}): Promise<Buffer[]> {
  const logId = await aiLogService.start({
    purpose: 'logo-generation',
    mode: 'api',
    runtime: 'zenmux',
    model: input.model,
    command: input.endpoint,
    prompt: input.prompt,
    metadata: { count: String(input.count) },
  });
  try {
    const buffers = input.model.startsWith('openai/')
      ? await generateViaImagesApi(input)
      : await Promise.all(Array.from({ length: input.count }, () => generateViaVertex(input)));
    await aiLogService.finish(logId, {
      status: 'succeeded',
      output: `${buffers.length} image(s) generated.`,
    });
    return buffers;
  } catch (error) {
    await aiLogService.finish(logId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function generateViaImagesApi(input: {
  endpoint: string;
  apiKey: string;
  model: AiLabZenmuxModel;
  prompt: string;
  count: number;
}): Promise<Buffer[]> {
  const url = `${trimTrailingSlash(input.endpoint)}/images/generations`;
  const body = await postJson<OpenAiImagesResponse>(url, input.apiKey, {
    model: input.model,
    prompt: input.prompt,
    n: input.count,
    size: '1024x1024',
  });

  const buffers = (body.data ?? [])
    .map((item) => item.b64_json)
    .filter((b64): b64 is string => typeof b64 === 'string' && b64.length > 0)
    .map((b64) => Buffer.from(b64, 'base64'));
  if (buffers.length === 0) {
    throw new Error('ZenMux Images API returned no image data.');
  }
  return buffers;
}

async function generateViaVertex(input: {
  endpoint: string;
  apiKey: string;
  model: AiLabZenmuxModel;
  prompt: string;
}): Promise<Buffer> {
  // Default endpoint https://zenmux.ai/api/v1 → Vertex base https://zenmux.ai/api/vertex-ai
  const root = trimTrailingSlash(input.endpoint).replace(/\/v1$/, '');
  const url = `${root}/vertex-ai/v1/models/${input.model}:generateContent`;
  const body = await postJson<VertexGenerateContentResponse>(url, input.apiKey, {
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  for (const part of body.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) {
      return Buffer.from(data, 'base64');
    }
  }
  throw new Error('ZenMux Vertex API returned no inline image data.');
}

async function postJson<T extends ApiErrorBody>(
  url: string,
  apiKey: string,
  payload: unknown
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    let body: T | null = null;
    try {
      body = (await response.json()) as T;
    } catch {
      body = null;
    }

    if (!response.ok || !body) {
      throw new Error(
        `ZenMux image request failed (${response.status}): ${extractErrorMessage(
          body,
          response.statusText || 'Request failed.'
        )}`
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function postMultipart<T extends ApiErrorBody>(
  url: string,
  apiKey: string,
  form: FormData
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    let body: T | null = null;
    try {
      body = (await response.json()) as T;
    } catch {
      body = null;
    }

    if (!response.ok || !body) {
      throw new Error(
        `ZenMux image request failed (${response.status}): ${extractErrorMessage(
          body,
          response.statusText || 'Request failed.'
        )}`
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function extractErrorMessage(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (typeof body.error === 'object' && body.error?.message?.trim()) return body.error.message;
  if (body.message?.trim()) return body.message;
  return fallback;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function sourceFileName(mimeType: AiLabImageMimeType): string {
  if (mimeType === 'image/jpeg') return 'source.jpg';
  if (mimeType === 'image/webp') return 'source.webp';
  return 'source.png';
}
