import { afterEach, describe, expect, it, vi } from 'vitest';
import { editZenmuxImage } from './zenmux-image-client';

const logMocks = vi.hoisted(() => ({
  start: vi.fn(async () => 'log-1'),
  finish: vi.fn(async () => undefined),
}));

vi.mock('@main/core/ai-logs/ai-log-service', () => ({
  aiLogService: logMocks,
}));

describe('ZenMux image edit client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends a reference image through the official Vertex image edit protocol', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            predictions: [{ bytesBase64Encoded: Buffer.from('edited').toString('base64') }],
          }),
        }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await editZenmuxImage({
      endpoint: 'https://zenmux.ai/api/v1/',
      apiKey: 'secret',
      appId: 'app-1',
      prompt: 'Preserve the person and render a Riso portrait.',
      source: Buffer.from('image'),
      sourceMimeType: 'image/png',
      size: '1024x1024',
      quality: 'high',
    });

    expect(result.toString()).toBe('edited');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/openai/models/gpt-image-2:predict'
    );
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      instances: [
        {
          prompt: 'Preserve the person and render a Riso portrait.',
          image: {
            bytesBase64Encoded: Buffer.from('image').toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
      parameters: {
        sampleCount: 1,
        imageSize: '1024x1024',
        quality: 'high',
        outputOptions: { mimeType: 'image/png' },
      },
    });
    expect(logMocks.finish).toHaveBeenCalledWith('log-1', {
      status: 'succeeded',
      output: '1 edited image generated.',
    });
  });
});
