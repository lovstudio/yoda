import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getClaudeRetentionSettings,
  updateClaudeRetentionSettings,
} from './claude-retention-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'yoda-claude-retention-'));
  temporaryDirectories.push(home);
  return home;
}

describe('Claude retention settings', () => {
  it('reports the Claude Code 30-day default when unset', async () => {
    await expect(getClaudeRetentionSettings(await createHome())).resolves.toEqual({
      cleanupPeriodDays: null,
      effectiveCleanupPeriodDays: 30,
      configured: false,
    });
  });

  it('preserves comments and unrelated JSONC fields while updating retention', async () => {
    const home = await createHome();
    const directory = join(home, '.claude');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'settings.json'),
      '{\n  // keep this hook\n  "hooks": { "Stop": [] },\n}\n'
    );

    await expect(updateClaudeRetentionSettings(3650, home)).resolves.toEqual({
      cleanupPeriodDays: 3650,
      effectiveCleanupPeriodDays: 3650,
      configured: true,
    });
    const written = await readFile(join(directory, 'settings.json'), 'utf8');
    expect(written).toContain('// keep this hook');
    expect(written).toContain('"hooks"');
    expect(written).toContain('"cleanupPeriodDays": 3650');
  });

  it('rejects invalid values and malformed settings without overwriting them', async () => {
    const home = await createHome();
    const directory = join(home, '.claude');
    await mkdir(directory, { recursive: true });
    const configPath = join(directory, 'settings.json');
    await writeFile(configPath, '{ broken');

    await expect(updateClaudeRetentionSettings(0, home)).rejects.toThrow('大于或等于 1');
    await expect(updateClaudeRetentionSettings(90, home)).rejects.toThrow('JSON/JSONC');
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{ broken');
  });
});
