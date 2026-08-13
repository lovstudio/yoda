import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateGlobalLlmImage } from './image-generation-service';

const mocks = vi.hoisted(() => ({
  settings: {
    profiles: [
      {
        id: 'image',
        name: 'Image profile',
        runtimeId: 'codex',
        authProvider: 'yoda-maas',
        maasPlatformId: 'zenmux',
        model: '',
        imageModel: 'openai/gpt-image-2',
        reasoningEffort: 'default',
        permissionMode: 'default',
      },
    ],
    defaultProfileId: 'image',
    namingProfileId: 'image',
    imageGenerationProfileId: 'image',
    promptTranslationEnabled: false,
    promptTranslationProfileId: 'image',
    promptTranslationShowOriginal: true,
  },
  getInferenceCredentials: vi.fn(),
  logStart: vi.fn(),
  logFinish: vi.fn(),
  createFromBuffer: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn(async () => mocks.settings) },
}));

vi.mock('@main/core/maas/maas-service', () => ({
  maasService: { getInferenceCredentials: mocks.getInferenceCredentials },
}));

vi.mock('@main/core/ai-logs/ai-log-service', () => ({
  aiLogService: { start: mocks.logStart, finish: mocks.logFinish },
}));

describe('generateGlobalLlmImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInferenceCredentials.mockResolvedValue({
      endpoint: 'https://images.example.test/v1/',
      apiKey: 'secret',
    });
    mocks.logStart.mockResolvedValue('log-1');
    mocks.logFinish.mockResolvedValue(undefined);
    mocks.createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      resize: () => ({ toPNG: () => Buffer.from('small-avatar') }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the assigned Profile and requests a low-quality speed-first image', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ b64_json: Buffer.from('source-image').toString('base64') }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGlobalLlmImage({ prompt: 'an orange robot' });

    expect(result).toEqual({
      imageDataUrl: `data:image/png;base64,${Buffer.from('small-avatar').toString('base64')}`,
      profileId: 'image',
      profileName: 'Image profile',
      model: 'openai/gpt-image-2',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://images.example.test/v1/images/generations');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'openai/gpt-image-2',
      n: 1,
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
    });
    expect(mocks.logFinish).toHaveBeenCalledWith('log-1', {
      status: 'succeeded',
      output: 'Generated a 256x256 avatar image.',
    });
  });

  it('reports an actionable error when the Profile service is disconnected', async () => {
    mocks.getInferenceCredentials.mockResolvedValue(undefined);

    await expect(generateGlobalLlmImage({ prompt: 'a small mascot' })).rejects.toThrow(
      'not connected'
    );
  });
});
