import type { AiLabZenmuxModel } from '@shared/ai-lab';

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
  if (input.model.startsWith('openai/')) {
    return generateViaImagesApi(input);
  }
  return Promise.all(Array.from({ length: input.count }, () => generateViaVertex(input)));
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
