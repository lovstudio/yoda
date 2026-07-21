import { describe, expect, it } from 'vitest';
import { AI_LAB_USER_NOTE_MAX_CHARS } from '@shared/ai-lab-bridge';
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
    expect(result.sourceMimeType).toBe('image/png');
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

  it('appends a trimmed user note to the generation prompt', () => {
    const result = normalizeAiLabImageEditInput({
      appId: 'app-1',
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      prompt: 'Preserve the portrait.',
      userNote: '  Keep the glasses and fix the left hand.  ',
    });

    expect(result.input.prompt).toContain('Preserve the portrait.');
    expect(result.input.prompt).toContain('Additional user note for this generation.');
    expect(result.input.prompt).toMatch(/Keep the glasses and fix the left hand\.$/);
  });

  it('rejects an oversized user note', () => {
    expect(() =>
      normalizeAiLabImageEditInput({
        appId: 'app-1',
        imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
        prompt: 'Restyle the portrait.',
        userNote: 'a'.repeat(AI_LAB_USER_NOTE_MAX_CHARS + 1),
      })
    ).toThrow('user note exceeds');
  });

  it('rejects a note when the combined instructions exceed the prompt limit', () => {
    expect(() =>
      normalizeAiLabImageEditInput({
        appId: 'app-1',
        imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
        prompt: 'a'.repeat(3_900),
        userNote: 'b'.repeat(100),
      })
    ).toThrow('instructions and user note are too long');
  });

  it('returns a PNG data URL without exposing credentials', () => {
    expect(toAiLabImageEditResult(png)).toEqual({
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      model: 'openai/gpt-image-2',
    });
  });
});
