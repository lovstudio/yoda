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

  it('sends a reference image through the official JSON images edit protocol', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }),
        }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await editZenmuxImage({
      endpoint: 'https://zenmux.ai/api/v1/',
      apiKey: 'secret',
      appId: 'app-1',
      prompt: 'Preserve the person and render a Riso portrait.',
      imageDataUrl: 'data:image/png;base64,aW1hZ2U=',
      size: '1024x1024',
      quality: 'high',
    });

    expect(result.toString()).toBe('edited');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://zenmux.ai/api/v1/images/edits');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'openai/gpt-image-2',
      images: [{ image_url: 'data:image/png;base64,aW1hZ2U=' }],
      prompt: 'Preserve the person and render a Riso portrait.',
      input_fidelity: 'high',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
    });
    expect(logMocks.finish).toHaveBeenCalledWith('log-1', {
      status: 'succeeded',
      output: '1 edited image generated.',
    });
  });
});
