import { describe, expect, it } from 'vitest';
import { pastedImagePathMention } from '@renderer/lib/image-path-mention';
import { serializePromptWithTokens, tokenText, type PromptToken } from './prompt-attachment-tokens';

const imageToken: PromptToken = {
  id: 'image-1',
  kind: 'image',
  label: '图 1',
  path: '/tmp/reference image.png',
};

describe('image path attachment transport', () => {
  it('wraps image attachment paths in backticks when path mode is enabled', () => {
    expect(
      serializePromptWithTokens(`查看 ${tokenText(imageToken.label)}`, [imageToken], {
        imagesAsPaths: true,
      })
    ).toEqual({
      text: '查看 `@/tmp/reference image.png`',
      imagePaths: [],
    });
  });

  it('keeps native image markers when path mode is disabled', () => {
    expect(
      serializePromptWithTokens(tokenText(imageToken.label), [imageToken], {
        imagesAsPaths: false,
      })
    ).toEqual({
      text: '{{yoda-image:0}}',
      imagePaths: ['/tmp/reference image.png'],
    });
  });

  it('does not change ordinary file attachment transport', () => {
    const fileToken: PromptToken = {
      id: 'file-1',
      kind: 'file',
      label: 'notes.md',
      path: '/tmp/notes.md',
    };

    expect(
      serializePromptWithTokens(tokenText(fileToken.label), [fileToken], {
        imagesAsPaths: true,
      })
    ).toEqual({
      text: '@/tmp/notes.md',
      imagePaths: [],
    });
  });

  it('wraps pasted image path text without double-wrapping existing code', () => {
    expect(pastedImagePathMention('/tmp/reference image.png')).toBe('`@/tmp/reference image.png`');
    expect(pastedImagePathMention('@/tmp/reference image.png')).toBe('`@/tmp/reference image.png`');
    expect(pastedImagePathMention('"/tmp/reference image.png"')).toBe(
      '`@/tmp/reference image.png`'
    );
    expect(pastedImagePathMention('`@/tmp/reference image.png`')).toBe(
      '`@/tmp/reference image.png`'
    );
    expect(pastedImagePathMention('ordinary prompt text')).toBeNull();
  });
});
