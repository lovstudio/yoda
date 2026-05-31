import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectlessDefaultDirectory,
  resolveProjectlessDefaultDirectory,
} from './projectless-directory';

describe('projectless directory', () => {
  const tempDirs: string[] = [];

  function makeHomeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'yoda-projectless-home-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves under ~/Documents/Yoda/$DATE/$TITLE', () => {
    const homeDir = makeHomeDir();
    const now = new Date(2026, 4, 31, 9, 30);

    expect(
      resolveProjectlessDefaultDirectory({
        homeDir,
        title: 'Fix login!',
        now,
      })
    ).toBe(join(homeDir, 'Documents', 'Yoda', '2026-05-31', 'fix-login'));
  });

  it('creates the default projectless directory', async () => {
    const homeDir = makeHomeDir();
    const now = new Date(2026, 4, 31, 9, 30);

    const directory = await createProjectlessDefaultDirectory({
      homeDir,
      title: 'New idea',
      now,
    });

    expect(directory).toBe(join(homeDir, 'Documents', 'Yoda', '2026-05-31', 'new-idea'));
    expect(existsSync(directory)).toBe(true);
  });

  it('uses the next title suffix when the directory already exists', async () => {
    const homeDir = makeHomeDir();
    const now = new Date(2026, 4, 31, 9, 30);

    await createProjectlessDefaultDirectory({
      homeDir,
      title: 'Same title',
      now,
    });
    const directory = await createProjectlessDefaultDirectory({
      homeDir,
      title: 'Same title',
      now,
    });

    expect(directory).toBe(join(homeDir, 'Documents', 'Yoda', '2026-05-31', 'same-title-2'));
    expect(existsSync(directory)).toBe(true);
  });

  it('falls back to a safe title segment when the title has no slug', async () => {
    const homeDir = makeHomeDir();
    const now = new Date(2026, 4, 31, 9, 30);

    const directory = await createProjectlessDefaultDirectory({
      homeDir,
      title: '///',
      now,
    });

    expect(basename(directory)).toBe('session');
    expect(existsSync(directory)).toBe(true);
  });
});
