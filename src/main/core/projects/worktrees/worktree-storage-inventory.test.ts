import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { ProjectProvider } from '../project-provider';
import { getWorktreeStorageSnapshot } from './worktree-storage';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listProjects: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
    listProjects: mocks.listProjects,
  },
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

async function git(cwd: string, args: string[]): Promise<void> {
  await new LocalExecutionContext({ root: cwd }).exec('git', args);
}

describe('worktree storage unregistered inventory', () => {
  let root: string;
  let repoPath: string;
  let poolPath: string;
  let unknownOldPath: string;
  let unknownNewPath: string;
  let extraUnknownPaths: string[];
  const duArgs: string[][] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    duArgs.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-storage-inventory-'));
    repoPath = path.join(root, 'repo');
    poolPath = path.join(root, 'pool');
    unknownOldPath = path.join(poolPath, 'unknown-old');
    unknownNewPath = path.join(poolPath, 'unknown-new');
    extraUnknownPaths = Array.from({ length: 4 }, (_, index) =>
      path.join(poolPath, `unknown-extra-${index}`)
    );
    fs.mkdirSync(repoPath);
    fs.mkdirSync(poolPath);
    await git(repoPath, ['init']);
    await git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await git(repoPath, ['config', 'user.email', 'test@example.com']);
    await git(repoPath, ['config', 'user.name', 'Test']);
    await git(repoPath, ['commit', '--allow-empty', '-m', 'init']);
    await git(repoPath, ['branch', 'task/registered']);
    await git(repoPath, ['worktree', 'add', path.join(poolPath, 'registered'), 'task/registered']);
    fs.mkdirSync(path.join(unknownOldPath, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(unknownOldPath, 'nested', 'keep.txt'), 'old unknown data');
    fs.mkdirSync(unknownNewPath);
    fs.writeFileSync(path.join(unknownNewPath, 'keep.txt'), 'new unknown data');
    for (const [index, unknownPath] of extraUnknownPaths.entries()) {
      fs.mkdirSync(unknownPath);
      fs.writeFileSync(path.join(unknownPath, 'keep.txt'), `extra unknown data ${index}`);
    }
    const oldDate = new Date('2020-01-02T03:04:05.000Z');
    fs.utimesSync(unknownOldPath, oldDate, oldDate);

    const localCtx = new LocalExecutionContext({ root: repoPath });
    const ctx = {
      root: localCtx.root,
      supportsLocalSpawn: true,
      exec: async (command: string, args: string[] = [], options?: { timeout?: number }) => {
        if (command === 'du') duArgs.push(args);
        return localCtx.exec(command, args, options);
      },
      execStreaming: localCtx.execStreaming.bind(localCtx),
      dispose: localCtx.dispose.bind(localCtx),
    };
    const provider = {
      projectId: 'project-inventory',
      repoPath: fs.realpathSync(repoPath),
      worktreePoolPath: fs.realpathSync(poolPath),
      ctx,
    } as unknown as ProjectProvider;
    mocks.listProjects.mockReturnValue([provider]);
    mocks.getProject.mockReturnValue(provider);
    mocks.select.mockImplementation((selection: Record<string, unknown>) => {
      const projectSelection = Object.keys(selection).length === 2 && 'name' in selection;
      return {
        from: () =>
          projectSelection
            ? Promise.resolve([{ id: 'project-inventory', name: 'Inventory project' }])
            : { where: async () => [] },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('enumerates unknown directories without measuring them until an explicit refresh', async () => {
    const initial = await getWorktreeStorageSnapshot();

    expect(initial).toMatchObject({
      worktreeCount: 1,
      registeredActiveCount: 0,
      registeredDirtyCount: 0,
      reclaimableCount: 1,
      unregisteredUnknownCount: 6,
      unregisteredUnknownBytes: 0,
      unregisteredUnknownInspectionPendingCount: 6,
      unregisteredUnknownInventoryPendingProjectCount: 0,
      unregisteredUnknownScanInProgress: false,
      oldestUnregisteredUnknownAt: '2020-01-02T03:04:05.000Z',
    });
    expect(initial.unregisteredUnknownItems.map((item) => item.path)).toEqual([
      ...extraUnknownPaths.map((unknownPath) => fs.realpathSync(unknownPath)),
      fs.realpathSync(unknownNewPath),
      fs.realpathSync(unknownOldPath),
    ]);
    expect(duArgs.flat()).not.toContain(fs.realpathSync(unknownOldPath));
    expect(duArgs.flat()).not.toContain(fs.realpathSync(unknownNewPath));

    const refreshed = await getWorktreeStorageSnapshot({ forceRefresh: true });

    expect(refreshed.unregisteredUnknownBytes).toBeGreaterThan(0);
    expect(refreshed.unregisteredUnknownInspectionPendingCount).toBe(2);
    expect(refreshed.unregisteredUnknownScanInProgress).toBe(true);

    const completed = await getWorktreeStorageSnapshot();

    expect(completed.unregisteredUnknownInspectionPendingCount).toBe(0);
    expect(completed.unregisteredUnknownScanInProgress).toBe(false);
    expect(completed.unregisteredUnknownItems.every((item) => item.sizeBytes !== null)).toBe(true);
    expect(duArgs.flat()).toContain(fs.realpathSync(unknownOldPath));
    expect(duArgs.flat()).toContain(fs.realpathSync(unknownNewPath));
    expect(fs.readFileSync(path.join(unknownOldPath, 'nested', 'keep.txt'), 'utf8')).toBe(
      'old unknown data'
    );
  });
});
