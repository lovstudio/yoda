import { describe, expect, it } from 'vitest';
import type { MobileSessionTranscriptBlock } from './mobile-api';
import {
  formatMobileToolTranscriptContent,
  groupAdjacentMobileToolBlocks,
  mobileToolGroupTitle,
  summarizeMobileToolTranscriptContent,
} from './mobile-tool-transcript';

function block(
  id: string,
  role: MobileSessionTranscriptBlock['role'],
  title?: string
): MobileSessionTranscriptBlock {
  return {
    id,
    role,
    ...(title ? { title } : {}),
    timestamp: null,
    format: role === 'tool' ? 'code' : 'plain',
    content: id,
  };
}

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

  it('incrementally groups adjacent tool calls while preserving surrounding messages', () => {
    const firstPass = groupAdjacentMobileToolBlocks([
      block('assistant-1', 'assistant'),
      block('tool-1', 'tool', 'Run command'),
    ]);
    const secondPass = groupAdjacentMobileToolBlocks([
      block('assistant-1', 'assistant'),
      block('tool-1', 'tool', 'Run command'),
      block('tool-2', 'tool', 'Run command'),
      block('tool-3', 'tool', 'Tool · wait'),
      block('assistant-2', 'assistant'),
    ]);

    expect(firstPass).toEqual([
      expect.objectContaining({ kind: 'block', id: 'assistant-1' }),
      expect.objectContaining({ kind: 'tool-group', id: 'tool-1' }),
    ]);
    expect(secondPass).toEqual([
      expect.objectContaining({ kind: 'block', id: 'assistant-1' }),
      expect.objectContaining({
        kind: 'tool-group',
        id: 'tool-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({ id: 'tool-1' }),
          expect.objectContaining({ id: 'tool-2' }),
          expect.objectContaining({ id: 'tool-3' }),
        ]),
      }),
      expect.objectContaining({ kind: 'block', id: 'assistant-2' }),
    ]);
  });

  it('uses a counted title for repeated and mixed tool groups', () => {
    expect(
      mobileToolGroupTitle([
        block('tool-1', 'tool', 'Run command'),
        block('tool-2', 'tool', 'Run command'),
      ])
    ).toBe('Run command（2）');
    expect(
      mobileToolGroupTitle([
        block('tool-1', 'tool', 'Run command'),
        block('tool-2', 'tool', 'Tool · wait'),
      ])
    ).toBe('Tools（2）');
  });
});
