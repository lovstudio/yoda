import { describe, expect, it } from 'vitest';
import { transformTerminalPasteText } from './terminal-image-paste';

describe('terminal image path paste', () => {
  it('wraps an image path when the setting is enabled', () => {
    expect(transformTerminalPasteText('/tmp/reference image.png', true)).toBe(
      '`@/tmp/reference image.png`'
    );
  });

  it('leaves the same path unchanged when the setting is disabled', () => {
    expect(transformTerminalPasteText('/tmp/reference image.png', false)).toBe(
      '/tmp/reference image.png'
    );
  });

  it('does not rewrite ordinary terminal input', () => {
    expect(transformTerminalPasteText('pnpm test', true)).toBe('pnpm test');
  });
});
