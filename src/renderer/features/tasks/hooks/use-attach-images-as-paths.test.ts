import { describe, expect, it } from 'vitest';
import { resolveAttachImagesAsPaths } from './attach-images-as-paths';

describe('resolveAttachImagesAsPaths', () => {
  it('uses the project override when present', () => {
    expect(resolveAttachImagesAsPaths(false, true)).toBe(true);
    expect(resolveAttachImagesAsPaths(true, false)).toBe(false);
  });

  it('falls back to the global value and then false', () => {
    expect(resolveAttachImagesAsPaths(true, undefined)).toBe(true);
    expect(resolveAttachImagesAsPaths(undefined, undefined)).toBe(false);
  });
});
