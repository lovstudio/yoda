export type WorktreeStorageDescriptor = {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  head: string | null;
};

export type CachedWorktreeInspection = WorktreeStorageDescriptor & {
  sizeBytes: number;
  dirty: boolean;
  inspectedAtMs: number | null;
  inspectionPending: boolean;
};

export type WorktreeInspectionUpdate = {
  key: string;
  sizeBytes: number;
  dirty: boolean;
};

export type WorktreeInspectionTarget = WorktreeStorageDescriptor & {
  key: string;
  previousSizeBytes: number;
};

type RefreshCycle = {
  cutoffMs: number;
  refreshAll: boolean;
};

type ReconcileOptions = {
  descriptors: WorktreeStorageDescriptor[];
  observedProjectIds: Set<string>;
  activeProjectIds: Set<string>;
  nowMs: number;
  forceRefresh?: boolean;
};

type WorktreeStorageInspectionCacheOptions = {
  batchSize: number;
  fullRefreshIntervalMs: number;
};

type CacheEntry = WorktreeStorageDescriptor & {
  sizeBytes: number;
  dirty: boolean;
  inspectedAtMs: number | null;
};

export function worktreeInspectionKey(projectId: string, worktreePath: string): string {
  return `${projectId}\0${worktreePath}`;
}

export class WorktreeStorageInspectionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly options: WorktreeStorageInspectionCacheOptions;
  private refreshableKeys = new Set<string>();
  private refreshCycle: RefreshCycle | null = null;
  private lastFullRefreshAtMs: number | null = null;

  constructor(options: WorktreeStorageInspectionCacheOptions) {
    this.options = options;
  }

  reconcile(options: ReconcileOptions): WorktreeInspectionTarget[] {
    const descriptorKeys = new Set(
      options.descriptors.map((descriptor) =>
        worktreeInspectionKey(descriptor.projectId, descriptor.path)
      )
    );
    this.refreshableKeys = descriptorKeys;

    for (const [key, entry] of this.entries) {
      if (
        !options.activeProjectIds.has(entry.projectId) ||
        (options.observedProjectIds.has(entry.projectId) && !descriptorKeys.has(key))
      ) {
        this.entries.delete(key);
      }
    }

    let addedOrChanged = false;
    for (const descriptor of options.descriptors) {
      const key = worktreeInspectionKey(descriptor.projectId, descriptor.path);
      const cached = this.entries.get(key);
      if (!cached || cached.branch !== descriptor.branch || cached.head !== descriptor.head) {
        this.entries.set(key, {
          ...descriptor,
          sizeBytes: cached?.sizeBytes ?? 0,
          dirty: cached?.dirty ?? true,
          inspectedAtMs: null,
        });
        addedOrChanged = true;
        continue;
      }
      cached.projectName = descriptor.projectName;
    }

    if (!this.refreshCycle) {
      const fullRefreshDue =
        options.forceRefresh === true ||
        this.lastFullRefreshAtMs === null ||
        options.nowMs - this.lastFullRefreshAtMs >= this.options.fullRefreshIntervalMs;
      if (fullRefreshDue || addedOrChanged || this.hasUninspectedEntries()) {
        this.refreshCycle = {
          cutoffMs: options.nowMs,
          refreshAll: fullRefreshDue,
        };
      }
    }

    return this.pendingEntries()
      .sort((left, right) => {
        if (left.inspectedAtMs === null && right.inspectedAtMs !== null) return -1;
        if (left.inspectedAtMs !== null && right.inspectedAtMs === null) return 1;
        return (left.inspectedAtMs ?? 0) - (right.inspectedAtMs ?? 0);
      })
      .slice(0, this.options.batchSize)
      .map((entry) => ({
        key: worktreeInspectionKey(entry.projectId, entry.path),
        projectId: entry.projectId,
        projectName: entry.projectName,
        path: entry.path,
        branch: entry.branch,
        head: entry.head,
        previousSizeBytes: entry.sizeBytes,
      }));
  }

  complete(updates: WorktreeInspectionUpdate[], inspectedAtMs: number): void {
    for (const update of updates) {
      const entry = this.entries.get(update.key);
      if (!entry) continue;
      entry.sizeBytes = update.sizeBytes;
      entry.dirty = update.dirty;
      entry.inspectedAtMs = inspectedAtMs;
    }

    if (this.refreshCycle && this.pendingEntries().length === 0) {
      if (this.refreshCycle.refreshAll) {
        this.lastFullRefreshAtMs = inspectedAtMs;
      }
      this.refreshCycle = null;
    }
  }

  getEntries(): CachedWorktreeInspection[] {
    const pendingKeys = new Set(
      this.pendingEntries().map((entry) => worktreeInspectionKey(entry.projectId, entry.path))
    );
    return Array.from(this.entries, ([key, entry]) => ({
      ...entry,
      inspectionPending: pendingKeys.has(key),
    }));
  }

  get pendingCount(): number {
    return this.pendingEntries().length;
  }

  private hasUninspectedEntries(): boolean {
    for (const [key, entry] of this.entries) {
      if (this.refreshableKeys.has(key) && entry.inspectedAtMs === null) return true;
    }
    return false;
  }

  private pendingEntries(): CacheEntry[] {
    if (!this.refreshCycle) return [];
    return Array.from(this.entries, ([key, entry]) => ({ key, entry }))
      .filter(
        ({ key, entry }) =>
          this.refreshableKeys.has(key) &&
          (entry.inspectedAtMs === null ||
            (this.refreshCycle?.refreshAll === true &&
              entry.inspectedAtMs < this.refreshCycle.cutoffMs))
      )
      .map(({ entry }) => entry);
  }
}
