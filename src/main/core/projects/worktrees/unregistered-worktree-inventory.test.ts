import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listUnregisteredWorktreeDirectories,
  UnregisteredWorktreeDirectoryInventoryCache,
  UnregisteredWorktreeInspectionCache,
  unregisteredWorktreeInspectionKey,
  type UnregisteredWorktreeDescriptor,
  type UnregisteredWorktreeInventoryProject,
} from './unregistered-worktree-inventory';

describe('listUnregisteredWorktreeDirectories', () => {
  let poolPath: string;

  beforeEach(() => {
    poolPath = fs.mkdtempSync(path.join(os.tmpdir(), 'unregistered-worktrees-'));
  });

  afterEach(() => {
    fs.rmSync(poolPath, { recursive: true, force: true });
  });

  it('lists unknown first-level directories without traversing or changing them', async () => {
    const registered = path.join(poolPath, 'registered');
    const legacyContainer = path.join(poolPath, 'legacy');
    const nestedRegistered = path.join(legacyContainer, 'task');
    const unknown = path.join(poolPath, 'unknown');
    fs.mkdirSync(registered);
    fs.mkdirSync(nestedRegistered, { recursive: true });
    fs.mkdirSync(path.join(unknown, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(unknown, 'nested', 'keep.txt'), 'keep me');

    const result = await listUnregisteredWorktreeDirectories({
      poolPath,
      registeredWorktrees: [
        { path: registered, branch: 'task/registered', head: 'one' },
        { path: nestedRegistered, branch: 'task/nested', head: 'two' },
      ],
      statConcurrency: 2,
    });

    expect(result.map((item) => item.path)).toEqual([unknown]);
    expect(result[0]?.modifiedAtMs).toEqual(expect.any(Number));
    expect(fs.readFileSync(path.join(unknown, 'nested', 'keep.txt'), 'utf8')).toBe('keep me');
  });
});

function inventoryProject(
  registeredWorktrees: UnregisteredWorktreeInventoryProject['registeredWorktrees'] = []
): UnregisteredWorktreeInventoryProject {
  return {
    projectId: 'project-1',
    poolPath: '/pool',
    registeredWorktrees,
  };
}

describe('UnregisteredWorktreeDirectoryInventoryCache', () => {
  const activeProjectIds = new Set(['project-1']);

  it('reuses one directory inventory throughout a size scan and its progress polls', () => {
    const cache = new UnregisteredWorktreeDirectoryInventoryCache(1_000);
    const project = inventoryProject();
    const [initialTarget] = cache.reconcile({
      projects: [project],
      activeProjectIds,
      nowMs: 1_000,
      allowRefresh: true,
    });
    expect(initialTarget).toBeDefined();
    cache.complete({
      results: [
        {
          projectId: 'project-1',
          inventoryKey: initialTarget!.inventoryKey,
          directories: [{ path: '/pool/unknown', modifiedAtMs: 500 }],
        },
      ],
      inspectedAtMs: 1_100,
    });

    expect(
      cache.reconcile({
        projects: [project],
        activeProjectIds,
        nowMs: 1_200,
        allowRefresh: true,
        freezeRefresh: true,
      })
    ).toEqual([]);
    expect(
      cache.reconcile({
        projects: [project],
        activeProjectIds,
        nowMs: 2_200,
        allowRefresh: true,
        freezeRefresh: true,
      })
    ).toEqual([]);
    expect(cache.getEntries(2_200)[0]).toMatchObject({
      directories: [{ path: '/pool/unknown', modifiedAtMs: 500 }],
      inspectionPending: true,
      inspectionFailed: false,
    });

    expect(
      cache.reconcile({
        projects: [project],
        activeProjectIds,
        nowMs: 2_200,
        allowRefresh: true,
      })
    ).toHaveLength(1);
  });

  it('refreshes when Git registration changes and retains data after a failed refresh', () => {
    const cache = new UnregisteredWorktreeDirectoryInventoryCache(60_000);
    const initialProject = inventoryProject();
    const [initialTarget] = cache.reconcile({
      projects: [initialProject],
      activeProjectIds,
      nowMs: 1_000,
      allowRefresh: true,
    });
    cache.complete({
      results: [
        {
          projectId: 'project-1',
          inventoryKey: initialTarget!.inventoryKey,
          directories: [{ path: '/pool/unknown', modifiedAtMs: 500 }],
        },
      ],
      inspectedAtMs: 1_100,
    });

    const [failedTarget] = cache.reconcile({
      projects: [initialProject],
      activeProjectIds,
      nowMs: 1_200,
      allowRefresh: true,
      forceRefresh: true,
    });
    cache.complete({
      results: [
        {
          projectId: 'project-1',
          inventoryKey: failedTarget!.inventoryKey,
          directories: null,
        },
      ],
      inspectedAtMs: 1_300,
    });

    expect(cache.getEntries(1_300)[0]).toMatchObject({
      directories: [{ path: '/pool/unknown', modifiedAtMs: 500 }],
      inspectionPending: true,
      inspectionFailed: true,
    });
    expect(
      cache.reconcile({
        projects: [initialProject],
        activeProjectIds,
        nowMs: 1_400,
        allowRefresh: true,
      })
    ).toEqual([]);
    expect(
      cache.reconcile({
        projects: [initialProject],
        activeProjectIds,
        nowMs: 1_400,
        allowRefresh: true,
        forceRefresh: true,
      })
    ).toHaveLength(1);

    const changedProject = inventoryProject([
      { path: '/pool/registered', branch: 'task/registered', head: 'one' },
    ]);
    expect(
      cache.reconcile({
        projects: [changedProject],
        activeProjectIds,
        nowMs: 1_500,
        allowRefresh: true,
      })
    ).toHaveLength(1);
  });
});

function descriptor(pathValue: string, modifiedAtMs = 1_000): UnregisteredWorktreeDescriptor {
  return {
    projectId: 'project-1',
    projectName: 'Yoda',
    path: pathValue,
    modifiedAtMs,
  };
}

describe('UnregisteredWorktreeInspectionCache', () => {
  const activeProjectIds = new Set(['project-1']);
  const observedProjectIds = new Set(['project-1']);

  it('never starts recursive size inspection during an ordinary snapshot', () => {
    const cache = new UnregisteredWorktreeInspectionCache({
      batchSize: 2,
      freshnessTtlMs: 60_000,
    });
    const descriptors = [descriptor('/pool/one'), descriptor('/pool/two')];

    const targets = cache.reconcile({
      descriptors,
      activeProjectIds,
      observedProjectIds,
      nowMs: 1_000,
    });

    expect(targets).toEqual([]);
    expect(cache.scanInProgress).toBe(false);
    expect(cache.getEntries(1_000).every((entry) => entry.inspectionPending)).toBe(true);
  });

  it('inspects only bounded batches after an explicit refresh', () => {
    const cache = new UnregisteredWorktreeInspectionCache({
      batchSize: 1,
      freshnessTtlMs: 60_000,
    });
    const descriptors = [descriptor('/pool/one'), descriptor('/pool/two')];

    const first = cache.reconcile({
      descriptors,
      activeProjectIds,
      observedProjectIds,
      nowMs: 1_000,
      forceRefresh: true,
    });
    expect(first.map((entry) => entry.path)).toEqual(['/pool/one']);
    cache.complete({
      attemptedKeys: first.map((entry) => entry.key),
      updates: [{ key: first[0]!.key, sizeBytes: 42 }],
      inspectedAtMs: 1_100,
    });
    expect(cache.scanInProgress).toBe(true);

    const second = cache.reconcile({
      descriptors,
      activeProjectIds,
      observedProjectIds,
      nowMs: 1_200,
    });
    expect(second.map((entry) => entry.path)).toEqual(['/pool/two']);
    cache.complete({
      attemptedKeys: second.map((entry) => entry.key),
      updates: [{ key: second[0]!.key, sizeBytes: 84 }],
      inspectedAtMs: 1_300,
    });

    expect(cache.scanInProgress).toBe(false);
    expect(cache.getEntries(1_300).map((entry) => entry.sizeBytes)).toEqual([42, 84]);
  });

  it('keeps failed and stale measurements pending without retrying on polling', () => {
    const cache = new UnregisteredWorktreeInspectionCache({
      batchSize: 2,
      freshnessTtlMs: 1_000,
    });
    const item = descriptor('/pool/unknown');
    const [target] = cache.reconcile({
      descriptors: [item],
      activeProjectIds,
      observedProjectIds,
      nowMs: 1_000,
      forceRefresh: true,
    });
    cache.complete({ attemptedKeys: [target!.key], updates: [], inspectedAtMs: 1_100 });

    expect(cache.getEntries(1_100)[0]).toMatchObject({
      sizeBytes: null,
      inspectionPending: true,
      inspectionFailed: true,
    });
    expect(
      cache.reconcile({
        descriptors: [item],
        activeProjectIds,
        observedProjectIds,
        nowMs: 1_200,
      })
    ).toEqual([]);

    const key = unregisteredWorktreeInspectionKey('project-1', '/pool/unknown');
    const retry = cache.reconcile({
      descriptors: [item],
      activeProjectIds,
      observedProjectIds,
      nowMs: 2_200,
      forceRefresh: true,
    });
    expect(retry.map((entry) => entry.key)).toEqual([key]);
  });
});
