import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertProjectMoveTarget, moveLocalProjectDirectory } from './move-project-directory';

const temporaryRoots: string[] = [];

function makeTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-project-move-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('moveLocalProjectDirectory', () => {
  it('creates missing parent directories and moves the complete project directory', async () => {
    const root = makeTemporaryRoot();
    const source = path.join(root, 'current-project');
    const target = path.join(root, 'new', 'nested', 'renamed-project');
    fs.mkdirSync(path.join(source, '.git'), { recursive: true });
    fs.writeFileSync(path.join(source, 'README.md'), 'project contents');

    const moved = await moveLocalProjectDirectory(source, target);

    expect(moved.targetPath).toBe(target);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe('project contents');
    expect(fs.statSync(path.join(target, '.git')).isDirectory()).toBe(true);

    await moved.finalize();
  });

  it('restores the original directory when the caller rolls the move back', async () => {
    const root = makeTemporaryRoot();
    const source = path.join(root, 'current-project');
    const target = path.join(root, 'new-project');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'keep.txt'), 'keep me');

    const moved = await moveLocalProjectDirectory(source, target);
    await moved.rollback();

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('keep me');
  });

  it('uses an existing empty directory as the move destination', async () => {
    const root = makeTemporaryRoot();
    const source = path.join(root, 'current-project');
    const target = path.join(root, 'empty-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'keep.txt'), 'keep me');

    const moved = await moveLocalProjectDirectory(source, target);

    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('keep me');

    await moved.rollback();

    expect(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8')).toBe('keep me');
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('keeps an existing target untouched', async () => {
    const root = makeTemporaryRoot();
    const source = path.join(root, 'current-project');
    const target = path.join(root, 'existing-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'source.txt'), 'source');
    fs.writeFileSync(path.join(target, 'target.txt'), 'target');

    await expect(moveLocalProjectDirectory(source, target)).rejects.toThrow(
      'The target path already exists'
    );

    expect(fs.readFileSync(path.join(source, 'source.txt'), 'utf8')).toBe('source');
    expect(fs.readFileSync(path.join(target, 'target.txt'), 'utf8')).toBe('target');
  });
});

describe('assertProjectMoveTarget', () => {
  it('rejects a target nested inside the project being moved', () => {
    expect(() =>
      assertProjectMoveTarget('/projects/current', '/projects/current/nested/new-location')
    ).toThrow('cannot be inside the current project directory');
  });
});
