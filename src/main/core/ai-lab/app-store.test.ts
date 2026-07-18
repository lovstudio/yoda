import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiLabAppStore } from './app-store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AiLabAppStore', () => {
  it('creates, pins, and deletes an app with atomic JSON persistence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-'));
    directories.push(directory);
    const filePath = join(directory, 'apps.json');
    const store = new AiLabAppStore(filePath);
    const created = await store.create({
      name: 'Packing',
      description: 'A packing list',
      prompt: 'Build a packing list',
      html: '<!doctype html><html></html>',
      projectId: 'travel-project',
      runtimeId: 'codex',
      model: 'gpt-5.4',
    });

    expect((await store.list())[0]).toMatchObject({
      id: created.id,
      projectId: 'travel-project',
      runtimeId: 'codex',
      model: 'gpt-5.4',
      pinned: false,
    });
    expect(await store.update(created.id, { pinned: true })).toMatchObject({ pinned: true });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toHaveLength(1);

    await store.delete(created.id);
    expect(await store.list()).toEqual([]);
  });
});
