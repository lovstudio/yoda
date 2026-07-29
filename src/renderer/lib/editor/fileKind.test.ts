import { describe, expect, it } from 'vitest';
import { getFileKind, isPreviewableKind } from './fileKind';

describe('previewable file kinds', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['mockup.png', 'image'],
    ['notes.md', 'markdown'],
    ['diagram.svg', 'svg'],
  ] as const)('treats %s as a rendered preview', (filePath, expectedKind) => {
    const kind = getFileKind(filePath);

    expect(kind).toBe(expectedKind);
    expect(isPreviewableKind(kind)).toBe(true);
  });

  it('keeps source files out of the asset preview shortcut', () => {
    expect(isPreviewableKind(getFileKind('src/main.ts'))).toBe(false);
  });
});
