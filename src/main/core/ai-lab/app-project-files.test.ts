import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  markAiLabAppProjectDraft,
  migrateLegacyAiLabAppProject,
  readAiLabAppProjectBuild,
  scaffoldAiLabAppProject,
} from './app-project-files';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AI Lab App project files', () => {
  it('scaffolds a React/Vite project without overwriting existing source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-project-'));
    directories.push(directory);

    await scaffoldAiLabAppProject(directory, 'Trip planner');
    await writeFile(join(directory, 'src', 'App.tsx'), 'export const preserved = true;\n', 'utf8');
    await scaffoldAiLabAppProject(directory, 'Other name');

    await expect(readFile(join(directory, 'src', 'App.tsx'), 'utf8')).resolves.toContain(
      'preserved'
    );
    await expect(readFile(join(directory, 'package.json'), 'utf8')).resolves.toContain('"react"');
    await expect(readFile(join(directory, '.yoda.json'), 'utf8')).resolves.toContain('"pnpm dev');
    await expect(readFile(join(directory, '.yoda', 'app.json'), 'utf8')).resolves.toContain(
      '"status": "draft"'
    );
  });

  it('accepts only a checked, ready project build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-project-'));
    directories.push(directory);
    await scaffoldAiLabAppProject(directory, 'Trip planner');

    await expect(readAiLabAppProjectBuild(directory)).rejects.toThrow('marked as draft');
    const manifestPath = join(directory, '.yoda', 'app.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          template: 'react-vite',
          templateVersion: 1,
          status: 'ready',
          name: 'Trip planner',
          description: 'Plans a focused trip.',
          capabilities: ['ai.image.edit'],
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    await mkdir(join(directory, 'dist'), { recursive: true });
    await writeFile(join(directory, 'dist', 'index.html'), '<!doctype html>', 'utf8');

    await expect(readAiLabAppProjectBuild(directory)).resolves.toEqual({
      name: 'Trip planner',
      description: 'Plans a focused trip.',
      runtimeKind: 'react-vite',
      templateVersion: 1,
      capabilities: ['ai.image.edit'],
    });
    await markAiLabAppProjectDraft(directory);
    await expect(readAiLabAppProjectBuild(directory)).rejects.toThrow('marked as draft');
  });

  it('keeps a legacy source as migration reference instead of replacing the scaffold', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-project-'));
    directories.push(directory);
    await writeFile(join(directory, 'index.html'), '<!doctype html><html>Legacy</html>', 'utf8');
    await migrateLegacyAiLabAppProject(
      directory,
      'Legacy app',
      '<!doctype html><html>Legacy</html>'
    );

    await expect(readFile(join(directory, 'legacy', 'index.html'), 'utf8')).resolves.toContain(
      'Legacy'
    );
    await expect(readFile(join(directory, 'index.html'), 'utf8')).resolves.toContain(
      '/src/main.tsx'
    );
    await expect(readFile(join(directory, 'src', 'App.tsx'), 'utf8')).resolves.toContain(
      '你的 App 正在创建'
    );
  });
});
