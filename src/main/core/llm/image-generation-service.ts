import { nativeImage } from 'electron';
import {
  getLlmProfile,
  normalizeLlmSettings,
  type GlobalLlmImageGenerationInput,
  type GlobalLlmImageGenerationResult,
} from '@shared/global-llm';
import { aiLogService } from '@main/core/ai-logs/ai-log-service';
import { maasService } from '@main/core/maas/maas-service';
import { appSettingsService } from '@main/core/settings/settings-service';

const MAX_PROMPT_CHARS = 800;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const AVATAR_SIZE = 256;

type ImageApiBody = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: string | { message?: string };
  message?: string;
};

export async function generateGlobalLlmImage(
  input: GlobalLlmImageGenerationInput
): Promise<GlobalLlmImageGenerationResult> {
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) throw new Error('Describe the avatar you want to generate.');

  const settings = normalizeLlmSettings(await appSettingsService.get('llm'));
  const profile = getLlmProfile(settings, settings.imageGenerationProfileId);
  if (profile.authProvider !== 'yoda-maas') {
    throw new Error('The image generation Profile must use Yoda model access.');
  }
  if (!profile.imageModel) {
    throw new Error('The image generation Profile does not have an image model.');
  }

  const credentials = await maasService.getInferenceCredentials(profile.maasPlatformId);
  if (!credentials) {
    throw new Error('The image generation Profile is not connected to its model access service.');
  }

  const url = `${credentials.endpoint.replace(/\/+$/, '')}/images/generations`;
  const generationPrompt = buildAvatarPrompt(prompt);
  const logId = await aiLogService.start({
    purpose: 'avatar-generation',
    mode: 'api',
    runtime: profile.runtimeId,
    model: profile.imageModel,
    command: url,
    prompt: generationPrompt,
    metadata: { llmProfileId: profile.id, size: `${AVATAR_SIZE}x${AVATAR_SIZE}` },
  });

  try {
    const source = await requestImage({
      url,
      apiKey: credentials.apiKey,
      model: profile.imageModel,
      prompt: generationPrompt,
    });
    const image = nativeImage.createFromBuffer(source);
    if (image.isEmpty()) throw new Error('The image service returned an invalid image.');
    const png = image.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: 'good' }).toPNG();
    const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;

    await aiLogService.finish(logId, {
      status: 'succeeded',
      output: `Generated a ${AVATAR_SIZE}x${AVATAR_SIZE} avatar image.`,
    });
    return {
      imageDataUrl,
      profileId: profile.id,
      profileName: profile.name,
      model: profile.imageModel,
    };
  } catch (error) {
    await aiLogService.finish(logId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function requestImage(input: {
  url: string;
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        n: 1,
        size: '1024x1024',
        quality: 'low',
        output_format: 'png',
      }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      throw new Error(
        `Image generation failed (${response.status}): ${extractError(body, response.statusText)}`
      );
    }

    const item = body.data?.[0];
    if (item?.b64_json) return validateImageSize(Buffer.from(item.b64_json, 'base64'));
    if (item?.url) return validateImageSize(Buffer.from(await fetchImageUrl(item.url)));
    throw new Error('The image service returned no image data.');
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<ImageApiBody> {
  try {
    return (await response.json()) as ImageApiBody;
  } catch {
    return {};
  }
}

async function fetchImageUrl(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Generated image download failed (${response.status}).`);
  const size = Number(response.headers.get('content-length') ?? 0);
  if (size > MAX_IMAGE_BYTES) throw new Error('The generated image is too large.');
  return response.arrayBuffer();
}

function validateImageSize(buffer: Buffer): Buffer {
  if (buffer.length === 0) throw new Error('The image service returned an empty image.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('The generated image is too large.');
  return buffer;
}

function extractError(body: ImageApiBody, fallback: string): string {
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (typeof body.error === 'object' && body.error?.message?.trim()) return body.error.message;
  if (body.message?.trim()) return body.message;
  return fallback || 'Request failed.';
}

function buildAvatarPrompt(description: string): string {
  return [
    `Create a friendly cartoon profile avatar: ${description}`,
    'Square head-and-shoulders composition, centered subject, simple background, clear silhouette.',
    'No text, no logo, no watermark, no border, suitable for a small app avatar.',
  ].join('\n');
}
