import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const patch = readFileSync('native/macos/yoda-sparkle-updater/delta-only.patch', 'utf8');

describe('Yoda Sparkle helper patch', () => {
  it('blocks every non-delta request before download', () => {
    expect(patch).toContain('willDownloadUpdate:(SUAppcastItem *)item');
    expect(patch).toContain('if (!item.deltaUpdate)');
    expect(patch).toContain('127.0.0.1:9/yoda-full-update-disabled');
    expect(patch).toContain('full-update-blocked');
  });

  it('contains no full-download bypass', () => {
    expect(patch).not.toMatch(/allowFull|fallbackToFull|disableDeltaOnly/i);
  });

  it('emits structured progress events', () => {
    expect(patch).toContain('download-start');
    expect(patch).toContain('download-progress');
    expect(patch).toContain('ready-to-install');
  });
});
