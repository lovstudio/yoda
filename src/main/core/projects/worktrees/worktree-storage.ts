import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type {
  UnregisteredWorktreeStorageItem,
  WorktreeCleanupResult,
  WorktreeStorageItem,
  WorktreeStorageSnapshot,
  WorktreeStorageSnapshotOptions,
} from '@shared/app-resource';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { db } from '@main/db/client';
import { projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { projectManager } from '../project-manager';
import type { ProjectProvider } from '../project-provider';
import {
  listUnregisteredWorktreeDirectories,
  UnregisteredWorktreeDirectoryInventoryCache,
  UnregisteredWorktreeInspectionCache,
  type UnregisteredWorktreeDescriptor,
  type UnregisteredWorktreeInspectionTarget,
  type UnregisteredWorktreeInspectionUpdate,
  type UnregisteredWorktreeInventoryRefreshResult,
} from './unregistered-worktree-inventory';
import { assertNoTmuxSessionUsesWorktree } from './worktree-cwd-guard';
import {
  WorktreeStorageInspectionCache,
  type WorktreeInspectionTarget,
  type WorktreeInspectionUpdate,
  type WorktreeStorageDescriptor,
} from './worktree-storage-cache';
import { parseWorktreePorcelain, type ListedWorktree } from './worktree-storage-parse';
import {
  groupActiveTasksByBranch,
  isWorktreeReclaimable,
  type ActiveTaskReference,
} from './worktree-task-references';

const STATUS_TIMEOUT_MS = 5_000;
const SIZE_TIMEOUT_MS = 30_000;
const INSPECTION_BATCH_SIZE = 6;
const FULL_REFRESH_INTERVAL_MS = 60_000;
const UNREGISTERED_STAT_CONCURRENCY = 16;
const UNREGISTERED_INSPECTION_BATCH_SIZE = 4;
const UNREGISTERED_INVENTORY_FRESHNESS_TTL_MS = 15 * 60_000;
const UNREGISTERED_SIZE_FRESHNESS_TTL_MS = 15 * 60_000;

const inspectionCache = new WorktreeStorageInspectionCache({
  batchSize: INSPECTION_BATCH_SIZE,
  fullRefreshIntervalMs: FULL_REFRESH_INTERVAL_MS,
});
const unregisteredInspectionCache = new UnregisteredWorktreeInspectionCache({
  batchSize: UNREGISTERED_INSPECTION_BATCH_SIZE,
  freshnessTtlMs: UNREGISTERED_SIZE_FRESHNESS_TTL_MS,
});
const unregisteredDirectoryInventoryCache = new UnregisteredWorktreeDirectoryInventoryCache(
  UNREGISTERED_INVENTORY_FRESHNESS_TTL_MS
);
let snapshotQueue: Promise<void> = Promise.resolve();

type ListedProjectWorktrees = {
  poolPath: string;
  items: ListedWorktree[];
};

function isPoolResident(poolPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(poolPath), path.resolve(candidatePath));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function parseDuSizes(output: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of output.split('\n')) {
    const match = /^(\d+)\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    sizes.set(path.resolve(match[2]), Number(match[1]) * 1024);
  }
  return sizes;
}

async function measureWorktrees(
  ctx: IExecutionContext,
  worktreePaths: string[]
): Promise<Map<string, number>> {
  if (worktreePaths.length === 0) return new Map();
  try {
    const { stdout } = await ctx.exec('du', ['-sk', ...worktreePaths], {
      timeout: SIZE_TIMEOUT_MS,
    });
    return parseDuSizes(stdout);
  } catch (error) {
    log.warn('worktree-storage: failed to measure worktree directories', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

async function listProjectWorktrees(
  provider: ProjectProvider
): Promise<ListedProjectWorktrees | null> {
  if (!provider.ctx.supportsLocalSpawn) return null;
  try {
    const [{ stdout }, poolPath, repoPath] = await Promise.all([
      provider.ctx.exec('git', ['worktree', 'list', '--porcelain'], {
        timeout: STATUS_TIMEOUT_MS,
      }),
      fsPromises.realpath(provider.worktreePoolPath),
      fsPromises.realpath(provider.repoPath).catch(() => path.resolve(provider.repoPath)),
    ]);
    return {
      poolPath,
      items: parseWorktreePorcelain(stdout).filter(
        (item) => path.resolve(item.path) !== repoPath && isPoolResident(poolPath, item.path)
      ),
    };
  } catch {
    return null;
  }
}

async function inspectWorktreeBatch(
  targets: WorktreeInspectionTarget[],
  providersById: Map<string, ProjectProvider>
): Promise<WorktreeInspectionUpdate[]> {
  const targetsByProject = new Map<string, WorktreeInspectionTarget[]>();
  for (const target of targets) {
    const projectTargets = targetsByProject.get(target.projectId) ?? [];
    projectTargets.push(target);
    targetsByProject.set(target.projectId, projectTargets);
  }

  return (
    await Promise.all(
      Array.from(targetsByProject, async ([projectId, projectTargets]) => {
        const provider = providersById.get(projectId);
        if (!provider?.ctx.supportsLocalSpawn) return [];
        const [sizes, dirtyResults] = await Promise.all([
          measureWorktrees(
            provider.ctx,
            projectTargets.map((target) => target.path)
          ),
          Promise.all(
            projectTargets.map((target) =>
              provider.ctx
                .exec('git', ['-C', target.path, 'status', '--porcelain'], {
                  timeout: STATUS_TIMEOUT_MS,
                })
                .then(({ stdout }) => stdout.trim().length > 0)
                .catch(() => true)
            )
          ),
        ]);
        return projectTargets.map((target, index) => ({
          key: target.key,
          sizeBytes: sizes.get(path.resolve(target.path)) ?? target.previousSizeBytes,
          dirty: dirtyResults[index] ?? true,
        }));
      })
    )
  ).flat();
}

async function inspectUnregisteredWorktreeBatch(
  targets: UnregisteredWorktreeInspectionTarget[],
  providersById: Map<string, ProjectProvider>
): Promise<{
  attemptedKeys: string[];
  updates: UnregisteredWorktreeInspectionUpdate[];
}> {
  const targetsByProject = new Map<string, UnregisteredWorktreeInspectionTarget[]>();
  for (const target of targets) {
    const projectTargets = targetsByProject.get(target.projectId) ?? [];
    projectTargets.push(target);
    targetsByProject.set(target.projectId, projectTargets);
  }

  const updates = (
    await Promise.all(
      Array.from(targetsByProject, async ([projectId, projectTargets]) => {
        const provider = providersById.get(projectId);
        if (!provider?.ctx.supportsLocalSpawn) return [];
        const sizes = await measureWorktrees(
          provider.ctx,
          projectTargets.map((target) => target.path)
        );
        return projectTargets.flatMap<UnregisteredWorktreeInspectionUpdate>((target) => {
          const sizeBytes = sizes.get(path.resolve(target.path));
          return sizeBytes === undefined ? [] : [{ key: target.key, sizeBytes }];
        });
      })
    )
  ).flat();

  return { attemptedKeys: targets.map((target) => target.key), updates };
}

async function activeTasksByBranch(): Promise<Map<string, Map<string, ActiveTaskReference>>> {
  const rows = await db
    .select({
      id: tasks.id,
      name: tasks.name,
      projectId: tasks.projectId,
      taskBranch: tasks.taskBranch,
    })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), isNotNull(tasks.taskBranch)));
  return groupActiveTasksByBranch(rows);
}

async function hasActiveTaskReference(projectId: string, branch: string): Promise<boolean> {
  const [activeTask] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, projectId), eq(tasks.taskBranch, branch), isNull(tasks.archivedAt))
    )
    .limit(1);
  return activeTask !== undefined;
}

async function buildWorktreeStorageSnapshot(
  options: WorktreeStorageSnapshotOptions,
  runtimeOptions: { inspectUnregisteredSizes: boolean }
): Promise<WorktreeStorageSnapshot> {
  const nowMs = Date.now();
  const providers = projectManager
    .listProjects()
    .filter((provider) => provider.ctx.supportsLocalSpawn);
  const providersById = new Map(providers.map((provider) => [provider.projectId, provider]));
  const [projectRows, tasksByProjectBranch, inventories] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects),
    activeTasksByBranch(),
    Promise.all(
      providers.map(async (provider) => {
        const listed = await listProjectWorktrees(provider);
        return { provider, listed };
      })
    ),
  ]);
  const names = new Map(projectRows.map((project) => [project.id, project.name]));
  const activeProjectIds = new Set(providersById.keys());
  const inventoryRefreshTargets = unregisteredDirectoryInventoryCache.reconcile({
    projects: inventories.flatMap(({ provider, listed }) =>
      listed
        ? [
            {
              projectId: provider.projectId,
              poolPath: listed.poolPath,
              registeredWorktrees: listed.items,
            },
          ]
        : []
    ),
    activeProjectIds,
    nowMs,
    allowRefresh: runtimeOptions.inspectUnregisteredSizes,
    forceRefresh: runtimeOptions.inspectUnregisteredSizes && options.forceRefresh,
    freezeRefresh: unregisteredInspectionCache.scanInProgress,
  });
  const inventoryRefreshResults = await Promise.all(
    inventoryRefreshTargets.map<Promise<UnregisteredWorktreeInventoryRefreshResult>>(
      async (target) => {
        try {
          const directories = await listUnregisteredWorktreeDirectories({
            poolPath: target.poolPath,
            registeredWorktrees: target.registeredWorktrees,
            statConcurrency: UNREGISTERED_STAT_CONCURRENCY,
          });
          return {
            projectId: target.projectId,
            inventoryKey: target.inventoryKey,
            directories,
          };
        } catch (error) {
          log.warn('worktree-storage: failed to enumerate unregistered pool directories', {
            projectId: target.projectId,
            poolPath: target.poolPath,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            projectId: target.projectId,
            inventoryKey: target.inventoryKey,
            directories: null,
          };
        }
      }
    )
  );
  const inventoryInspectedAtMs = Date.now();
  unregisteredDirectoryInventoryCache.complete({
    results: inventoryRefreshResults,
    inspectedAtMs: inventoryInspectedAtMs,
  });
  const directoryInventories =
    unregisteredDirectoryInventoryCache.getEntries(inventoryInspectedAtMs);
  const directoryInventoriesByProject = new Map(
    directoryInventories.map((inventory) => [inventory.projectId, inventory])
  );
  const descriptors: WorktreeStorageDescriptor[] = inventories.flatMap(({ provider, listed }) =>
    (listed?.items ?? []).map((item) => ({
      projectId: provider.projectId,
      projectName: names.get(provider.projectId) ?? provider.projectId,
      path: item.path,
      branch: item.branch,
      head: item.head,
    }))
  );
  const unregisteredDescriptors: UnregisteredWorktreeDescriptor[] = directoryInventories.flatMap(
    (inventory) =>
      inventory.directories.map((item) => ({
        projectId: inventory.projectId,
        projectName: names.get(inventory.projectId) ?? inventory.projectId,
        path: item.path,
        modifiedAtMs: item.modifiedAtMs,
      }))
  );
  const registeredObservedProjectIds = new Set(
    inventories.filter(({ listed }) => listed !== null).map(({ provider }) => provider.projectId)
  );
  const listedProjectIds = registeredObservedProjectIds;
  const unregisteredObservedProjectIds = new Set(
    directoryInventories
      .filter(
        (inventory) => !inventory.inspectionPending && listedProjectIds.has(inventory.projectId)
      )
      .map((inventory) => inventory.projectId)
  );
  const unregisteredFailedProjectIds = new Set(
    providers
      .filter((provider) => {
        if (!listedProjectIds.has(provider.projectId)) return true;
        return directoryInventoriesByProject.get(provider.projectId)?.inspectionFailed === true;
      })
      .map((provider) => provider.projectId)
  );
  const registeredTargets = inspectionCache.reconcile({
    descriptors,
    observedProjectIds: registeredObservedProjectIds,
    activeProjectIds,
    nowMs,
    forceRefresh: options.forceRefresh,
  });
  const unregisteredTargets = runtimeOptions.inspectUnregisteredSizes
    ? unregisteredInspectionCache.reconcile({
        descriptors: unregisteredDescriptors.filter((descriptor) =>
          unregisteredObservedProjectIds.has(descriptor.projectId)
        ),
        observedProjectIds: unregisteredObservedProjectIds,
        activeProjectIds,
        nowMs,
        forceRefresh: options.forceRefresh,
      })
    : [];
  const [registeredUpdates, unregisteredResult] = await Promise.all([
    inspectWorktreeBatch(registeredTargets, providersById),
    runtimeOptions.inspectUnregisteredSizes
      ? inspectUnregisteredWorktreeBatch(unregisteredTargets, providersById)
      : Promise.resolve({ attemptedKeys: [], updates: [] }),
  ]);
  const inspectedAtMs = Date.now();
  inspectionCache.complete(registeredUpdates, inspectedAtMs);
  if (runtimeOptions.inspectUnregisteredSizes) {
    unregisteredInspectionCache.complete({ ...unregisteredResult, inspectedAtMs });
  }

  const items: WorktreeStorageItem[] = inspectionCache.getEntries().map((entry) => {
    const activeTask =
      entry.branch === null
        ? undefined
        : tasksByProjectBranch.get(entry.projectId)?.get(entry.branch);
    const referencedByActiveTask = activeTask !== undefined;
    return {
      projectId: entry.projectId,
      projectName: entry.projectName,
      path: entry.path,
      branch: entry.branch,
      activeTaskId: activeTask?.id ?? null,
      activeTaskName: activeTask?.name ?? null,
      sizeBytes: entry.sizeBytes,
      dirty: entry.dirty,
      inspectedAt:
        entry.inspectedAtMs === null ? null : new Date(entry.inspectedAtMs).toISOString(),
      inspectionPending: entry.inspectionPending,
      referencedByActiveTask,
      reclaimable: isWorktreeReclaimable({
        branch: entry.branch,
        dirty: entry.dirty,
        inspectionPending: entry.inspectionPending,
        referencedByActiveTask,
      }),
    };
  });
  const unregisteredUnknownItems: UnregisteredWorktreeStorageItem[] = unregisteredInspectionCache
    .getEntries(inspectedAtMs)
    .map((entry) => {
      const inventoryPending = !unregisteredObservedProjectIds.has(entry.projectId);
      return {
        projectId: entry.projectId,
        projectName: entry.projectName,
        path: entry.path,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAtMs === null ? null : new Date(entry.modifiedAtMs).toISOString(),
        inspectedAt:
          entry.inspectedAtMs === null ? null : new Date(entry.inspectedAtMs).toISOString(),
        inspectionPending: entry.inspectionPending || inventoryPending,
        inspectionFailed:
          entry.inspectionFailed || unregisteredFailedProjectIds.has(entry.projectId),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const reclaimable = items.filter((item) => item.reclaimable);
  const oldestUnregisteredUnknownTimestamp = unregisteredUnknownItems.reduce<number | null>(
    (oldest, item) => {
      const modifiedAtMs = item.modifiedAt === null ? Number.NaN : Date.parse(item.modifiedAt);
      if (!Number.isFinite(modifiedAtMs)) return oldest;
      return oldest === null ? modifiedAtMs : Math.min(oldest, modifiedAtMs);
    },
    null
  );
  return {
    sampledAt: new Date(inspectedAtMs).toISOString(),
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    reclaimableBytes: reclaimable.reduce((total, item) => total + item.sizeBytes, 0),
    worktreeCount: items.length,
    registeredActiveCount: items.filter((item) => item.referencedByActiveTask).length,
    registeredDirtyCount: items.filter((item) => item.dirty && !item.inspectionPending).length,
    reclaimableCount: reclaimable.length,
    pendingInspectionCount: inspectionCache.pendingCount,
    unregisteredUnknownCount: unregisteredUnknownItems.length,
    unregisteredUnknownBytes: unregisteredUnknownItems.reduce(
      (total, item) => total + (item.sizeBytes ?? 0),
      0
    ),
    unregisteredUnknownInspectionPendingCount: unregisteredUnknownItems.filter(
      (item) => item.inspectionPending
    ).length,
    unregisteredUnknownInventoryPendingProjectCount:
      providers.length - unregisteredObservedProjectIds.size,
    unregisteredUnknownScanInProgress: unregisteredInspectionCache.scanInProgress,
    oldestUnregisteredUnknownAt:
      oldestUnregisteredUnknownTimestamp === null
        ? null
        : new Date(oldestUnregisteredUnknownTimestamp).toISOString(),
    items,
    unregisteredUnknownItems,
  };
}

function queueWorktreeStorageSnapshot(
  options: WorktreeStorageSnapshotOptions,
  runtimeOptions: { inspectUnregisteredSizes: boolean }
): Promise<WorktreeStorageSnapshot> {
  const result = snapshotQueue.then(
    () => buildWorktreeStorageSnapshot(options, runtimeOptions),
    () => buildWorktreeStorageSnapshot(options, runtimeOptions)
  );
  snapshotQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function getWorktreeStorageSnapshot(
  options: WorktreeStorageSnapshotOptions = {}
): Promise<WorktreeStorageSnapshot> {
  return queueWorktreeStorageSnapshot(options, { inspectUnregisteredSizes: true });
}

export async function cleanupUnusedWorktrees(): Promise<WorktreeCleanupResult> {
  // This is the sole deletion entrypoint and is deliberately explicit: no
  // scheduler invokes it. Candidates come only from Git-registered items;
  // unregistered pool directories are read-only inventory and never enter this
  // loop, even when they are empty or old.
  let snapshot = await queueWorktreeStorageSnapshot(
    { forceRefresh: true },
    { inspectUnregisteredSizes: false }
  );
  while (snapshot.pendingInspectionCount > 0) {
    snapshot = await queueWorktreeStorageSnapshot({}, { inspectUnregisteredSizes: false });
  }
  let removedCount = 0;
  let reclaimedBytes = 0;
  const failedPaths: string[] = [];

  for (const item of snapshot.items.filter((candidate) => candidate.reclaimable)) {
    const provider = projectManager.getProject(item.projectId);
    if (!provider?.ctx.supportsLocalSpawn || item.branch === null) {
      failedPaths.push(item.path);
      continue;
    }
    try {
      // The snapshot may be stale by the time the user confirms cleanup. Re-read
      // both Git registration/branch state and the active task reference before
      // every deletion. Any uncertainty fails closed.
      const currentInventory = await listProjectWorktrees(provider);
      const current = currentInventory?.items.find(
        (candidate) => path.resolve(candidate.path) === path.resolve(item.path)
      );
      if (!current || current.branch !== item.branch) {
        throw new Error('worktree registration or branch changed after inspection');
      }
      await assertNoTmuxSessionUsesWorktree(provider.ctx, item.path);
      if (await hasActiveTaskReference(item.projectId, current.branch)) {
        throw new Error('worktree is now referenced by an active task');
      }

      await provider.worktreeService.removeWorktree(item.path, {
        expectedBranch: current.branch,
      });
      removedCount += 1;
      reclaimedBytes += item.sizeBytes;
    } catch (error) {
      failedPaths.push(item.path);
      log.warn('worktree-storage: safe cleanup skipped a worktree', {
        path: item.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { removedCount, reclaimedBytes, failedPaths };
}
