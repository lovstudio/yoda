import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  generateBlockmapWithAppBuilder,
  refreshMacUpdateMetadata,
  updateMacManifest,
} from '@root/scripts/release/lib/mac-update-metadata';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('macOS update metadata refresh', () => {
  it('updates stapled DMGs while preserving ZIP primary metadata and custom fields', () => {
    const manifest = createManifest();
    const updated = updateMacManifest(
      manifest,
      new Map([
        ['yoda-x64.dmg', { sha512: 'new-x64-dmg', size: 220 }],
        ['yoda-arm64.dmg', { sha512: 'new-arm64-dmg', size: 210 }],
      ])
    );
    const parsed = parse(updated);

    expect(parsed.path).toBe('https://example.test/v0.15.2/yoda-x64.zip');
    expect(parsed.sha512).toBe('x64-zip');
    expect(parsed.releaseDate).toBe('2026-07-11T00:00:00.000Z');
    expect(parsed.customTopLevel).toEqual({ preserved: true });
    expect(parsed.files).toEqual([
      {
        url: 'https://example.test/v0.15.2/yoda-x64.zip',
        sha512: 'x64-zip',
        size: 100,
        customFileField: 'preserved',
      },
      {
        url: 'https://example.test/v0.15.2/yoda-x64.dmg',
        sha512: 'new-x64-dmg',
        size: 220,
      },
      {
        url: 'yoda-arm64.zip',
        sha512: 'arm64-zip',
        size: 90,
      },
      {
        url: 'yoda-arm64.dmg',
        sha512: 'new-arm64-dmg',
        size: 210,
      },
    ]);
    expect(updateMacManifest(updated, new Map())).toBe(updated);
  });

  it('keeps the legacy top-level checksum aligned when a DMG is the primary path', () => {
    const manifest = `version: 1.0.0
files:
  - url: yoda-arm64.dmg
    sha512: stale
    size: 10
path: yoda-arm64.dmg
sha512: stale
`;
    const parsed = parse(
      updateMacManifest(manifest, new Map([['yoda-arm64.dmg', { sha512: 'refreshed', size: 12 }]]))
    );

    expect(parsed.files[0]).toMatchObject({ sha512: 'refreshed', size: 12 });
    expect(parsed.sha512).toBe('refreshed');
  });

  it('rejects ambiguous basenames and unmatched primary paths', () => {
    const duplicate = `version: 1.0.0
files:
  - url: yoda.dmg
    sha512: first
  - url: https://example.test/releases/yoda.dmg
    sha512: second
path: yoda.dmg
sha512: first
`;
    expect(() => updateMacManifest(duplicate, new Map())).toThrow(
      'Manifest contains duplicate artifact basename: yoda.dmg'
    );

    const unmatchedPath = `version: 1.0.0
files:
  - url: yoda.dmg
    sha512: first
path: missing.zip
sha512: missing
`;
    expect(() => updateMacManifest(unmatchedPath, new Map())).toThrow(
      'Manifest path does not match a files entry: missing.zip'
    );
  });

  it('fails before generating blockmaps when a referenced artifact is missing', async () => {
    const releaseDir = createReleaseDirectory();
    const manifestPath = join(releaseDir, 'v1-stable-mac.yml');
    writeFileSync(manifestPath, createManifest());
    writeFileSync(join(releaseDir, 'yoda-x64.dmg'), 'x64-dmg');
    writeFileSync(join(releaseDir, 'yoda-arm64.dmg'), 'arm64-dmg');
    writeFileSync(join(releaseDir, 'yoda-arm64.zip'), 'arm64-zip');
    const original = readFileSync(manifestPath, 'utf8');
    const generateBlockmap = vi.fn();

    await expect(refreshMacUpdateMetadata({ releaseDir, generateBlockmap })).rejects.toThrow(
      'Manifest references missing release artifact: yoda-x64.zip'
    );
    expect(generateBlockmap).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath, 'utf8')).toBe(original);
  });

  it('replaces both DMG blockmaps and their manifest metadata after preparation succeeds', async () => {
    const releaseDir = createReleaseDirectory();
    const manifestPath = join(releaseDir, 'v1-stable-mac.yml');
    writeFileSync(manifestPath, createManifest());
    for (const file of ['yoda-x64.zip', 'yoda-arm64.zip', 'yoda-x64.dmg', 'yoda-arm64.dmg']) {
      writeFileSync(join(releaseDir, file), `contents-${file}`);
    }
    const generateBlockmap = vi.fn(async (inputPath: string, outputPath: string) => {
      writeFileSync(outputPath, `blockmap-${basename(inputPath)}`);
      return {
        sha512: `sha512-${basename(inputPath)}`,
        size: readFileSync(inputPath).byteLength,
      };
    });

    const result = await refreshMacUpdateMetadata({ releaseDir, generateBlockmap });
    const parsed = parse(readFileSync(manifestPath, 'utf8'));

    expect(result).toEqual({
      manifestPath,
      artifacts: ['yoda-arm64.dmg', 'yoda-x64.dmg'],
    });
    expect(generateBlockmap).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(releaseDir, 'yoda-x64.dmg.blockmap'), 'utf8')).toBe(
      'blockmap-yoda-x64.dmg'
    );
    expect(readFileSync(join(releaseDir, 'yoda-arm64.dmg.blockmap'), 'utf8')).toBe(
      'blockmap-yoda-arm64.dmg'
    );
    expect(
      parsed.files.find((file: { url: string }) => file.url.endsWith('yoda-x64.dmg'))
    ).toMatchObject({ sha512: 'sha512-yoda-x64.dmg', size: 21 });
    expect(
      parsed.files.find((file: { url: string }) => file.url.endsWith('yoda-arm64.dmg'))
    ).toMatchObject({ sha512: 'sha512-yoda-arm64.dmg', size: 23 });
    expect(readdirSync(releaseDir).some((file) => file.includes('.refresh-'))).toBe(false);
  });

  it('uses electron-builder to generate a blockmap for the final artifact bytes', async () => {
    const releaseDir = createReleaseDirectory();
    const inputPath = join(releaseDir, 'sample.dmg');
    const outputPath = `${inputPath}.blockmap`;
    const contents = Buffer.from('post-staple-dmg-bytes');
    writeFileSync(inputPath, contents);

    const metadata = await generateBlockmapWithAppBuilder(inputPath, outputPath);

    expect(metadata).toEqual({
      sha512: createHash('sha512').update(contents).digest('base64'),
      size: contents.byteLength,
    });
    expect(readFileSync(outputPath).byteLength).toBeGreaterThan(0);
  });
});

function createReleaseDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'yoda-mac-update-metadata-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createManifest(): string {
  return `version: 0.15.2
files:
  - url: https://example.test/v0.15.2/yoda-x64.zip
    sha512: x64-zip
    size: 100
    customFileField: preserved
  - url: https://example.test/v0.15.2/yoda-x64.dmg
    sha512: stale-x64-dmg
    size: 200
  - url: yoda-arm64.zip
    sha512: arm64-zip
    size: 90
  - url: yoda-arm64.dmg
    sha512: stale-arm64-dmg
    size: 190
path: https://example.test/v0.15.2/yoda-x64.zip
sha512: x64-zip
releaseDate: '2026-07-11T00:00:00.000Z'
customTopLevel:
  preserved: true
`;
}
