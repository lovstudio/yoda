import { describe, expect, it, vi } from 'vitest';
import type { FileSystemProvider } from '@main/core/fs/types';
import { discoverProjectPackageScripts } from './discover-project-package-scripts';

function manifestReader(
  packageJson: Record<string, unknown>,
  existingFiles: string[] = []
): Pick<FileSystemProvider, 'exists' | 'read'> {
  return {
    exists: vi.fn(async (path: string) => existingFiles.includes(path)),
    read: vi.fn(async () => {
      const content = JSON.stringify(packageJson);
      return { content, totalSize: content.length, truncated: false };
    }),
  };
}

describe('discoverProjectPackageScripts', () => {
  it('uses the declared package manager and returns every package script in manifest order', async () => {
    const fs = manifestReader({
      packageManager: 'pnpm@10.28.2',
      scripts: {
        lint: 'eslint .',
        'mobile:ios': 'expo run:ios',
        start: 'next start',
        build: 'next build',
        dev: 'next dev',
        preview: 'vite preview',
      },
    });

    await expect(discoverProjectPackageScripts(fs)).resolves.toEqual([
      {
        id: 'package.json:lint',
        label: 'lint',
        command: 'pnpm run lint',
        source: 'package.json',
      },
      {
        id: 'package.json:mobile:ios',
        label: 'mobile:ios',
        command: 'pnpm run mobile:ios',
        source: 'package.json',
      },
      {
        id: 'package.json:start',
        label: 'start',
        command: 'pnpm run start',
        source: 'package.json',
      },
      {
        id: 'package.json:build',
        label: 'build',
        command: 'pnpm run build',
        source: 'package.json',
      },
      {
        id: 'package.json:dev',
        label: 'dev',
        command: 'pnpm run dev',
        source: 'package.json',
      },
      {
        id: 'package.json:preview',
        label: 'preview',
        command: 'pnpm run preview',
        source: 'package.json',
      },
    ]);
  });

  it('falls back to the repository lockfile', async () => {
    const fs = manifestReader(
      {
        scripts: {
          d: 'npm install && yarn run dev',
          test: 'vitest run',
        },
      },
      ['yarn.lock']
    );

    await expect(discoverProjectPackageScripts(fs)).resolves.toEqual([
      {
        id: 'package.json:d',
        label: 'd',
        command: 'yarn run d',
        source: 'package.json',
      },
      {
        id: 'package.json:test',
        label: 'test',
        command: 'yarn run test',
        source: 'package.json',
      },
    ]);
  });

  it('returns an empty list for missing or malformed package manifests', async () => {
    const fs = manifestReader({});
    vi.mocked(fs.read).mockRejectedValue(new Error('missing'));

    await expect(discoverProjectPackageScripts(fs)).resolves.toEqual([]);
  });
});
