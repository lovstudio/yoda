import { describe, expect, it } from 'vitest';
import {
  worktreeInspectionKey,
  WorktreeStorageInspectionCache,
  type WorktreeStorageDescriptor,
} from './worktree-storage-cache';

const projectIds = new Set(['project-1']);

function descriptor(path: string, head = 'head-1'): WorktreeStorageDescriptor {
  return {
    projectId: 'project-1',
    projectName: 'Yoda',
    path,
    branch: `yoda/${path.split('/').at(-1)}`,
    head,
  };
}

function reconcile(
  cache: WorktreeStorageInspectionCache,
  descriptors: WorktreeStorageDescriptor[],
  nowMs: number,
  forceRefresh = false
) {
  return cache.reconcile({
    descriptors,
    observedProjectIds: projectIds,
    activeProjectIds: projectIds,
    nowMs,
    forceRefresh,
  });
}

function complete(cache: WorktreeStorageInspectionCache, paths: string[], inspectedAtMs: number) {
  cache.complete(
    paths.map((path, index) => ({
      key: worktreeInspectionKey('project-1', path),
      sizeBytes: (index + 1) * 1_000,
      dirty: false,
    })),
    inspectedAtMs
  );
}

describe('WorktreeStorageInspectionCache', () => {
  it('inspects a new inventory in bounded batches and then reuses the fresh cache', () => {
    const cache = new WorktreeStorageInspectionCache({
      batchSize: 2,
      fullRefreshIntervalMs: 60_000,
    });
    const descriptors = [
      descriptor('/worktrees/one'),
      descriptor('/worktrees/two'),
      descriptor('/worktrees/three'),
    ];

    const firstBatch = reconcile(cache, descriptors, 1_000);
    expect(firstBatch.map((item) => item.path)).toEqual(['/worktrees/one', '/worktrees/two']);
    complete(
      cache,
      firstBatch.map((item) => item.path),
      1_100
    );
    expect(cache.pendingCount).toBe(1);

    const secondBatch = reconcile(cache, descriptors, 1_200);
    expect(secondBatch.map((item) => item.path)).toEqual(['/worktrees/three']);
    complete(
      cache,
      secondBatch.map((item) => item.path),
      1_300
    );

    expect(cache.pendingCount).toBe(0);
    expect(reconcile(cache, descriptors, 2_000)).toEqual([]);
    expect(cache.getEntries().every((item) => !item.inspectionPending)).toBe(true);

    const forcedBatch = reconcile(cache, descriptors, 2_100, true);
    expect(forcedBatch).toHaveLength(2);
    expect(cache.pendingCount).toBe(3);
  });

  it('re-inspects only a Worktree whose Git head changed during the freshness window', () => {
    const cache = new WorktreeStorageInspectionCache({
      batchSize: 4,
      fullRefreshIntervalMs: 60_000,
    });
    const initial = [descriptor('/worktrees/one'), descriptor('/worktrees/two')];
    const firstBatch = reconcile(cache, initial, 1_000);
    complete(
      cache,
      firstBatch.map((item) => item.path),
      1_100
    );

    const changed = [descriptor('/worktrees/one', 'head-2'), descriptor('/worktrees/two')];
    const incrementalBatch = reconcile(cache, changed, 2_000);

    expect(incrementalBatch.map((item) => item.path)).toEqual(['/worktrees/one']);
    expect(incrementalBatch[0]?.previousSizeBytes).toBe(1_000);
  });

  it('refreshes an older cache incrementally and removes vanished Worktrees', () => {
    const cache = new WorktreeStorageInspectionCache({
      batchSize: 1,
      fullRefreshIntervalMs: 1_000,
    });
    const initial = [descriptor('/worktrees/one'), descriptor('/worktrees/two')];
    const firstBatch = reconcile(cache, initial, 1_000);
    complete(cache, [firstBatch[0]!.path], 1_100);
    const secondBatch = reconcile(cache, initial, 1_200);
    complete(cache, [secondBatch[0]!.path], 1_300);

    const refreshBatch = reconcile(cache, [descriptor('/worktrees/two')], 2_500);

    expect(refreshBatch.map((item) => item.path)).toEqual(['/worktrees/two']);
    expect(cache.getEntries().map((item) => item.path)).toEqual(['/worktrees/two']);
    expect(cache.pendingCount).toBe(1);
  });
});
