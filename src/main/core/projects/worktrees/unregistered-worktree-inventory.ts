import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { ListedWorktree } from './worktree-storage-parse';

export type UnregisteredWorktreeDescriptor = {
  projectId: string;
  projectName: string;
  path: string;
  modifiedAtMs: number | null;
};

export type UnregisteredWorktreeInventoryProject = {
  projectId: string;
  poolPath: string;
  registeredWorktrees: ListedWorktree[];
};

export type UnregisteredWorktreeInventoryRefreshTarget = UnregisteredWorktreeInventoryProject & {
  inventoryKey: string;
};

export type UnregisteredWorktreeInventoryRefreshResult = {
  projectId: string;
  inventoryKey: string;
  directories: Array<{ path: string; modifiedAtMs: number | null }> | null;
};

export type CachedUnregisteredWorktreeInventory = {
  projectId: string;
  directories: Array<{ path: string; modifiedAtMs: number | null }>;
  inspectionPending: boolean;
  inspectionFailed: boolean;
};

export type UnregisteredWorktreeInspectionTarget = UnregisteredWorktreeDescriptor & {
  key: string;
};

export type UnregisteredWorktreeInspectionUpdate = {
  key: string;
  sizeBytes: number;
};

export type CachedUnregisteredWorktreeInspection = UnregisteredWorktreeDescriptor & {
  sizeBytes: number | null;
  inspectedAtMs: number | null;
  inspectionPending: boolean;
  inspectionFailed: boolean;
};

type CacheEntry = UnregisteredWorktreeDescriptor & {
  sizeBytes: number | null;
  inspectedAtMs: number | null;
  lastAttemptAtMs: number | null;
};

type RefreshCycle = {
  cutoffMs: number;
};

export function unregisteredWorktreeInspectionKey(projectId: string, worktreePath: string): string {
  return `${projectId}\0${worktreePath}`;
}

function isPoolDescendant(poolPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(poolPath), path.resolve(candidatePath));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function unregisteredWorktreeInventoryKey(project: UnregisteredWorktreeInventoryProject): string {
  const registeredTopLevelNames = new Set<string>();
  for (const worktree of project.registeredWorktrees) {
    if (!isPoolDescendant(project.poolPath, worktree.path)) continue;
    const [topLevelName] = path.relative(project.poolPath, worktree.path).split(path.sep);
    if (topLevelName) registeredTopLevelNames.add(topLevelName);
  }
  return JSON.stringify([
    path.resolve(project.poolPath),
    Array.from(registeredTopLevelNames).sort((left, right) => left.localeCompare(right)),
  ]);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await map(values[index]);
      }
    })
  );
  return results;
}

/**
 * Enumerates only first-level pool directories. A first-level container that
 * owns a registered nested worktree is known and therefore excluded.
 */
export async function listUnregisteredWorktreeDirectories(input: {
  poolPath: string;
  registeredWorktrees: ListedWorktree[];
  statConcurrency: number;
}): Promise<Array<{ path: string; modifiedAtMs: number | null }>> {
  const entries = await fsPromises.readdir(input.poolPath, { withFileTypes: true });
  const registeredTopLevelNames = new Set<string>();
  for (const worktree of input.registeredWorktrees) {
    if (!isPoolDescendant(input.poolPath, worktree.path)) continue;
    const [topLevelName] = path.relative(input.poolPath, worktree.path).split(path.sep);
    if (topLevelName) registeredTopLevelNames.add(topLevelName);
  }

  const unknownDirectories = entries
    .filter(
      (entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) && !registeredTopLevelNames.has(entry.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return mapWithConcurrency(unknownDirectories, input.statConcurrency, async (entry) => {
    const entryPath = path.join(input.poolPath, entry.name);
    const modifiedAtMs = await fsPromises
      .lstat(entryPath)
      .then((stat) => stat.mtimeMs)
      .catch(() => null);
    return { path: entryPath, modifiedAtMs };
  });
}

type DirectoryInventoryCacheEntry = {
  projectId: string;
  inventoryKey: string;
  directories: Array<{ path: string; modifiedAtMs: number | null }>;
  lastAttemptAtMs: number | null;
  lastSuccessfulAtMs: number | null;
  inspectionFailed: boolean;
  refreshDeferred: boolean;
};

/**
 * Caches first-level directory membership separately from recursive size
 * inspection. This keeps progress polling O(batch size): a long-running size
 * scan reuses the descriptors captured at its start instead of readdir/lstat
 * over the whole pool on every poll.
 */
export class UnregisteredWorktreeDirectoryInventoryCache {
  private readonly entries = new Map<string, DirectoryInventoryCacheEntry>();

  constructor(private readonly freshnessTtlMs: number) {}

  reconcile(input: {
    projects: UnregisteredWorktreeInventoryProject[];
    activeProjectIds: Set<string>;
    nowMs: number;
    allowRefresh: boolean;
    forceRefresh?: boolean;
    freezeRefresh?: boolean;
  }): UnregisteredWorktreeInventoryRefreshTarget[] {
    for (const projectId of this.entries.keys()) {
      if (!input.activeProjectIds.has(projectId)) this.entries.delete(projectId);
    }

    const targets: UnregisteredWorktreeInventoryRefreshTarget[] = [];
    for (const project of input.projects) {
      const inventoryKey = unregisteredWorktreeInventoryKey(project);
      let entry = this.entries.get(project.projectId);

      if (!input.allowRefresh) {
        if (entry && entry.inventoryKey !== inventoryKey) entry.refreshDeferred = true;
        continue;
      }

      // Preserve one stable descriptor set for the duration of a recursive
      // size scan. Git registration and directory membership are reconciled
      // as soon as that scan completes or the user explicitly refreshes again.
      if (input.freezeRefresh && entry) {
        if (entry.inventoryKey !== inventoryKey) entry.refreshDeferred = true;
        continue;
      }

      if (!entry || entry.inventoryKey !== inventoryKey) {
        entry = {
          projectId: project.projectId,
          inventoryKey,
          directories: [],
          lastAttemptAtMs: null,
          lastSuccessfulAtMs: null,
          inspectionFailed: false,
          refreshDeferred: false,
        };
        this.entries.set(project.projectId, entry);
      }

      const stale =
        entry.lastAttemptAtMs === null ||
        input.nowMs - entry.lastAttemptAtMs >= this.freshnessTtlMs;
      if (!input.allowRefresh || (!input.forceRefresh && !stale)) continue;
      targets.push({ ...project, inventoryKey });
    }
    return targets;
  }

  complete(input: {
    results: UnregisteredWorktreeInventoryRefreshResult[];
    inspectedAtMs: number;
  }): void {
    for (const result of input.results) {
      const entry = this.entries.get(result.projectId);
      if (!entry || entry.inventoryKey !== result.inventoryKey) continue;
      entry.lastAttemptAtMs = input.inspectedAtMs;
      if (result.directories === null) {
        entry.inspectionFailed = true;
        continue;
      }
      entry.directories = result.directories;
      entry.lastSuccessfulAtMs = input.inspectedAtMs;
      entry.inspectionFailed = false;
      entry.refreshDeferred = false;
    }
  }

  getEntries(nowMs: number): CachedUnregisteredWorktreeInventory[] {
    return Array.from(this.entries.values(), (entry) => ({
      projectId: entry.projectId,
      directories: entry.directories,
      inspectionPending:
        entry.inspectionFailed ||
        entry.refreshDeferred ||
        entry.lastSuccessfulAtMs === null ||
        entry.lastAttemptAtMs === null ||
        nowMs - entry.lastAttemptAtMs >= this.freshnessTtlMs,
      inspectionFailed: entry.inspectionFailed,
    }));
  }
}

export class UnregisteredWorktreeInspectionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private refreshableKeys = new Set<string>();
  private refreshCycle: RefreshCycle | null = null;

  constructor(
    private readonly options: {
      batchSize: number;
      freshnessTtlMs: number;
    }
  ) {}

  reconcile(input: {
    descriptors: UnregisteredWorktreeDescriptor[];
    observedProjectIds: Set<string>;
    activeProjectIds: Set<string>;
    nowMs: number;
    forceRefresh?: boolean;
  }): UnregisteredWorktreeInspectionTarget[] {
    const descriptorKeys = new Set(
      input.descriptors.map((descriptor) =>
        unregisteredWorktreeInspectionKey(descriptor.projectId, descriptor.path)
      )
    );
    this.refreshableKeys = descriptorKeys;

    for (const [key, entry] of this.entries) {
      if (
        !input.activeProjectIds.has(entry.projectId) ||
        (input.observedProjectIds.has(entry.projectId) && !descriptorKeys.has(key))
      ) {
        this.entries.delete(key);
      }
    }

    for (const descriptor of input.descriptors) {
      const key = unregisteredWorktreeInspectionKey(descriptor.projectId, descriptor.path);
      const cached = this.entries.get(key);
      if (!cached || cached.modifiedAtMs !== descriptor.modifiedAtMs) {
        this.entries.set(key, {
          ...descriptor,
          sizeBytes: null,
          inspectedAtMs: null,
          lastAttemptAtMs: null,
        });
        continue;
      }
      cached.projectName = descriptor.projectName;
    }

    if (input.forceRefresh && !this.refreshCycle) {
      this.refreshCycle = { cutoffMs: input.nowMs };
    }

    return this.pendingCycleEntries()
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, this.options.batchSize)
      .map((entry) => ({
        key: unregisteredWorktreeInspectionKey(entry.projectId, entry.path),
        projectId: entry.projectId,
        projectName: entry.projectName,
        path: entry.path,
        modifiedAtMs: entry.modifiedAtMs,
      }));
  }

  complete(input: {
    attemptedKeys: string[];
    updates: UnregisteredWorktreeInspectionUpdate[];
    inspectedAtMs: number;
  }): void {
    const updatesByKey = new Map(input.updates.map((update) => [update.key, update]));
    for (const key of input.attemptedKeys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.lastAttemptAtMs = input.inspectedAtMs;
      const update = updatesByKey.get(key);
      if (!update) continue;
      entry.sizeBytes = update.sizeBytes;
      entry.inspectedAtMs = input.inspectedAtMs;
    }

    if (this.refreshCycle && this.pendingCycleEntries().length === 0) {
      this.refreshCycle = null;
    }
  }

  getEntries(nowMs: number): CachedUnregisteredWorktreeInspection[] {
    return Array.from(this.entries.values(), (entry) => {
      const inspectionFailed =
        entry.lastAttemptAtMs !== null &&
        (entry.inspectedAtMs === null || entry.lastAttemptAtMs > entry.inspectedAtMs);
      const inspectionPending =
        entry.modifiedAtMs === null ||
        entry.inspectedAtMs === null ||
        inspectionFailed ||
        nowMs - entry.inspectedAtMs >= this.options.freshnessTtlMs;
      return {
        projectId: entry.projectId,
        projectName: entry.projectName,
        path: entry.path,
        modifiedAtMs: entry.modifiedAtMs,
        sizeBytes: entry.sizeBytes,
        inspectedAtMs: entry.inspectedAtMs,
        inspectionPending,
        inspectionFailed,
      };
    });
  }

  get scanInProgress(): boolean {
    return this.refreshCycle !== null;
  }

  private pendingCycleEntries(): CacheEntry[] {
    const refreshCycle = this.refreshCycle;
    if (!refreshCycle) return [];
    return Array.from(this.entries, ([key, entry]) => ({ key, entry }))
      .filter(
        ({ key, entry }) =>
          this.refreshableKeys.has(key) &&
          (entry.lastAttemptAtMs === null || entry.lastAttemptAtMs < refreshCycle.cutoffMs)
      )
      .map(({ entry }) => entry);
  }
}
