import { describe, expect, it } from 'vitest';
import { normalizeAiLabImageEditInput, toAiLabImageEditResult } from './app-image-edit';

describe('AI Lab app image edit validation', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  it('normalizes a valid image request with safe defaults', () => {
    const result = normalizeAiLabImageEditInput({
      appId: ' app-1 ',
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      prompt: ' restyle this portrait ',
    });

    expect(result.input).toMatchObject({
      appId: 'app-1',
      prompt: 'restyle this portrait',
      size: '1024x1024',
      quality: 'high',
    });
    expect(result.source).toEqual(png);
  });

  it('rejects malformed source image data', () => {
    expect(() =>
      normalizeAiLabImageEditInput({
        appId: 'app-1',
        imageDataUrl: 'data:image/png;base64,not valid',
        prompt: 'restyle',
      })
    ).toThrow('invalid');
  });

  it('returns a PNG data URL without exposing credentials', () => {
    expect(toAiLabImageEditResult(png)).toEqual({
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      model: 'openai/gpt-image-2',
    });
  });
});
