import { describe, expect, it } from 'vitest';
import {
  formatMobileToolTranscriptContent,
  summarizeMobileToolTranscriptContent,
} from './mobile-tool-transcript';

describe('mobile tool transcript formatting', () => {
  it('restores serialized newlines and tabs for the expanded inspector', () => {
    expect(
      formatMobileToolTranscriptContent(
        'const patch = "*** Begin Patch\\n*** Update File: src/App.tsx\\r\\n\\treturn next";'
      )
    ).toBe(
      ['const patch = "*** Begin Patch', '*** Update File: src/App.tsx', '  return next";'].join(
        '\n'
      )
    );
  });

  it('keeps existing line breaks and uses only the first meaningful line as a preview', () => {
    const content = '\n\n  pnpm run typecheck\nTests passed';

    expect(formatMobileToolTranscriptContent(content)).toBe(
      '\n\n  pnpm run typecheck\nTests passed'
    );
    expect(summarizeMobileToolTranscriptContent(content)).toBe('pnpm run typecheck');
  });
});
