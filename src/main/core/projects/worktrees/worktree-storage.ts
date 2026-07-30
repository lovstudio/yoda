import path from 'node:path';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type {
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
  WorktreeStorageInspectionCache,
  type WorktreeInspectionTarget,
  type WorktreeInspectionUpdate,
  type WorktreeStorageDescriptor,
} from './worktree-storage-cache';
import { parseWorktreePorcelain, type ListedWorktree } from './worktree-storage-parse';
import { groupActiveTasksByBranch, type ActiveTaskReference } from './worktree-task-references';

const STATUS_TIMEOUT_MS = 5_000;
const SIZE_TIMEOUT_MS = 30_000;
const REMOVE_TIMEOUT_MS = 120_000;
const INSPECTION_BATCH_SIZE = 6;
const FULL_REFRESH_INTERVAL_MS = 60_000;

const inspectionCache = new WorktreeStorageInspectionCache({
  batchSize: INSPECTION_BATCH_SIZE,
  fullRefreshIntervalMs: FULL_REFRESH_INTERVAL_MS,
});
let snapshotQueue: Promise<void> = Promise.resolve();

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

async function listProjectWorktrees(provider: ProjectProvider): Promise<ListedWorktree[] | null> {
  if (!provider.ctx.supportsLocalSpawn) return null;
  try {
    const { stdout } = await provider.ctx.exec('git', ['worktree', 'list', '--porcelain'], {
      timeout: STATUS_TIMEOUT_MS,
    });
    return parseWorktreePorcelain(stdout).filter(
      (item) =>
        item.path !== provider.repoPath && isPoolResident(provider.worktreePoolPath, item.path)
    );
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

async function buildWorktreeStorageSnapshot(
  options: WorktreeStorageSnapshotOptions
): Promise<WorktreeStorageSnapshot> {
  const providers = projectManager
    .listProjects()
    .filter((provider) => provider.ctx.supportsLocalSpawn);
  const providersById = new Map(providers.map((provider) => [provider.projectId, provider]));
  const [projectRows, tasksByProjectBranch, inventories] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects),
    activeTasksByBranch(),
    Promise.all(
      providers.map(async (provider) => ({
        provider,
        listed: await listProjectWorktrees(provider),
      }))
    ),
  ]);
  const names = new Map(projectRows.map((project) => [project.id, project.name]));
  const descriptors: WorktreeStorageDescriptor[] = inventories.flatMap(({ provider, listed }) =>
    (listed ?? []).map((item) => ({
      projectId: provider.projectId,
      projectName: names.get(provider.projectId) ?? provider.projectId,
      path: item.path,
      branch: item.branch,
      head: item.head,
    }))
  );
  const targets = inspectionCache.reconcile({
    descriptors,
    observedProjectIds: new Set(
      inventories.filter(({ listed }) => listed !== null).map(({ provider }) => provider.projectId)
    ),
    activeProjectIds: new Set(providersById.keys()),
    nowMs: Date.now(),
    forceRefresh: options.forceRefresh,
  });
  inspectionCache.complete(await inspectWorktreeBatch(targets, providersById), Date.now());

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
      reclaimable: !entry.dirty && !referencedByActiveTask,
    };
  });
  const reclaimable = items.filter((item) => item.reclaimable);
  return {
    sampledAt: new Date().toISOString(),
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    reclaimableBytes: reclaimable.reduce((total, item) => total + item.sizeBytes, 0),
    worktreeCount: items.length,
    reclaimableCount: reclaimable.length,
    pendingInspectionCount: inspectionCache.pendingCount,
    items,
  };
}

export function getWorktreeStorageSnapshot(
  options: WorktreeStorageSnapshotOptions = {}
): Promise<WorktreeStorageSnapshot> {
  const result = snapshotQueue.then(
    () => buildWorktreeStorageSnapshot(options),
    () => buildWorktreeStorageSnapshot(options)
  );
  snapshotQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function cleanupUnusedWorktrees(): Promise<WorktreeCleanupResult> {
  let snapshot = await getWorktreeStorageSnapshot({ forceRefresh: true });
  while (snapshot.pendingInspectionCount > 0) {
    snapshot = await getWorktreeStorageSnapshot();
  }
  let removedCount = 0;
  let reclaimedBytes = 0;
  const failedPaths: string[] = [];

  for (const item of snapshot.items.filter((candidate) => candidate.reclaimable)) {
    const provider = projectManager.getProject(item.projectId);
    if (!provider?.ctx.supportsLocalSpawn) {
      failedPaths.push(item.path);
      continue;
    }
    try {
      // No --force: Git performs one last clean-worktree check at deletion time.
      await provider.ctx.exec('git', ['worktree', 'remove', item.path], {
        timeout: REMOVE_TIMEOUT_MS,
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
