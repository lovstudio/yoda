import path from 'node:path';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type {
  WorktreeCleanupResult,
  WorktreeStorageItem,
  WorktreeStorageSnapshot,
} from '@shared/app-resource';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { db } from '@main/db/client';
import { projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { projectManager } from '../project-manager';
import type { ProjectProvider } from '../project-provider';
import { parseWorktreePorcelain, type ListedWorktree } from './worktree-storage-parse';
import { groupActiveTasksByBranch, type ActiveTaskReference } from './worktree-task-references';

const STATUS_TIMEOUT_MS = 5_000;
const SIZE_TIMEOUT_MS = 30_000;
const REMOVE_TIMEOUT_MS = 120_000;

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

async function inspectProjectWorktrees(args: {
  provider: ProjectProvider;
  projectName: string;
  activeTasksByBranch: Map<string, ActiveTaskReference>;
}): Promise<WorktreeStorageItem[]> {
  const { provider, projectName, activeTasksByBranch } = args;
  if (!provider.ctx.supportsLocalSpawn) return [];

  let listed: ListedWorktree[];
  try {
    const { stdout } = await provider.ctx.exec('git', ['worktree', 'list', '--porcelain'], {
      timeout: STATUS_TIMEOUT_MS,
    });
    listed = parseWorktreePorcelain(stdout).filter(
      (item) =>
        item.path !== provider.repoPath && isPoolResident(provider.worktreePoolPath, item.path)
    );
  } catch {
    return [];
  }

  const sizes = await measureWorktrees(
    provider.ctx,
    listed.map((item) => item.path)
  );
  const items: WorktreeStorageItem[] = [];
  for (const item of listed) {
    const dirty = await provider.ctx
      .exec('git', ['-C', item.path, 'status', '--porcelain'], { timeout: STATUS_TIMEOUT_MS })
      .then(({ stdout }) => stdout.trim().length > 0)
      .catch(() => true);
    const activeTask = item.branch === null ? undefined : activeTasksByBranch.get(item.branch);
    const referencedByActiveTask = activeTask !== undefined;
    items.push({
      projectId: provider.projectId,
      projectName,
      path: item.path,
      branch: item.branch,
      activeTaskId: activeTask?.id ?? null,
      activeTaskName: activeTask?.name ?? null,
      sizeBytes: sizes.get(path.resolve(item.path)) ?? 0,
      dirty,
      referencedByActiveTask,
      reclaimable: !dirty && !referencedByActiveTask,
    });
  }
  return items;
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

export async function getWorktreeStorageSnapshot(): Promise<WorktreeStorageSnapshot> {
  const [projectRows, tasksByProjectBranch] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects),
    activeTasksByBranch(),
  ]);
  const names = new Map(projectRows.map((project) => [project.id, project.name]));
  const items = (
    await Promise.all(
      projectManager.listProjects().map((provider) =>
        inspectProjectWorktrees({
          provider,
          projectName: names.get(provider.projectId) ?? provider.projectId,
          activeTasksByBranch:
            tasksByProjectBranch.get(provider.projectId) ?? new Map<string, ActiveTaskReference>(),
        })
      )
    )
  ).flat();
  const reclaimable = items.filter((item) => item.reclaimable);
  return {
    sampledAt: new Date().toISOString(),
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    reclaimableBytes: reclaimable.reduce((total, item) => total + item.sizeBytes, 0),
    worktreeCount: items.length,
    reclaimableCount: reclaimable.length,
    items,
  };
}

export async function cleanupUnusedWorktrees(): Promise<WorktreeCleanupResult> {
  const snapshot = await getWorktreeStorageSnapshot();
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
