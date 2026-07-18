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

  it('sends the source as a high-fidelity multipart image edit', async () => {
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
      source: Buffer.from('image'),
      sourceMimeType: 'image/png',
      size: '1024x1024',
      quality: 'high',
    });

    expect(result.toString()).toBe('edited');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://zenmux.ai/api/v1/images/edits');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer secret',
    });
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('openai/gpt-image-2');
    expect(form.get('prompt')).toBe('Preserve the person and render a Riso portrait.');
    expect(form.get('input_fidelity')).toBeNull();
    expect(form.get('n')).toBe('1');
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('quality')).toBe('high');
    expect(form.get('output_format')).toBe('png');
    const image = form.get('image[]');
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe('image/png');
    expect(Buffer.from(await (image as Blob).arrayBuffer()).toString()).toBe('image');
    expect([...form.keys()]).toEqual([
      'model',
      'image[]',
      'prompt',
      'n',
      'size',
      'quality',
      'output_format',
    ]);
    expect(logMocks.finish).toHaveBeenCalledWith('log-1', {
      status: 'succeeded',
      output: '1 edited image generated.',
    });
  });
});
