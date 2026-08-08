import { describe, expect, it } from 'vitest';
import { createScreenshotFileName } from './screenshot-file-name';

describe('createScreenshotFileName', () => {
  const now = new Date('2026-08-08T10:11:12.345Z');

  it('creates a readable filesystem-safe PNG name', () => {
    expect(createScreenshotFileName('设计 / review: latest?', now)).toBe(
      '设计 - review- latest-2026-08-08T10-11-12-345Z.png'
    );
  });

  it('falls back when the suggested name contains no usable characters', () => {
    expect(createScreenshotFileName(' /:*? ', now)).toBe(
      'latest-reply-2026-08-08T10-11-12-345Z.png'
    );
  });
});
