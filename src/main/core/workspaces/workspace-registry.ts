import type { Workspace } from './workspace';

export type TeardownMode = 'detach' | 'terminate';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceFactoryResult = { workspace: Workspace } & WorkspaceHooks;

type WorkspaceEntry = {
  workspace: Workspace;
  refCount: number;
  projectId: string;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

type WorkspaceAcquisition = {
  projectId: string;
  promise: Promise<Workspace>;
};

const PROJECT_WORKSPACE_DISPOSE_CONCURRENCY = 4;

class WorkspaceCleanupError extends Error {
  constructor(
    message: string,
    readonly errors: readonly unknown[]
  ) {
    super(message);
    this.name = 'WorkspaceCleanupError';
  }
}

async function runCleanupWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  cleanup: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const errors: unknown[] = [];
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        try {
          await cleanup(item);
        } catch (error) {
          errors.push(error);
        }
      }
    })
  );
  if (errors.length > 0) {
    throw new WorkspaceCleanupError(
      `Failed to dispose ${errors.length} workspace resource(s).`,
      errors
    );
  }
}

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, WorkspaceAcquisition>();
  private projectReleaseModes = new Map<string, TeardownMode>();
  private projectReleaseOperations = new Map<string, Promise<void>>();

  async acquire(
    key: string,
    projectId: string,
    factory: () => Promise<WorkspaceFactoryResult>
  ): Promise<Workspace> {
    if (this.projectReleaseModes.has(projectId)) {
      throw new Error(`Project workspaces are being disposed: ${projectId}`);
    }
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.projectId !== projectId) {
        throw new Error(`Workspace key is already owned by another project: ${key}`);
      }
      existing.refCount += 1;
      return existing.workspace;
    }

    const inFlight = this.acquiring.get(key);
    if (inFlight) {
      if (inFlight.projectId !== projectId) {
        throw new Error(`Workspace key is already owned by another project: ${key}`);
      }
      const workspace = await inFlight.promise;
      const current = this.entries.get(key);
      if (!current || this.projectReleaseModes.has(projectId)) {
        throw new Error(`Project workspace was disposed while being acquired: ${key}`);
      }
      current.refCount += 1;
      return workspace;
    }

    const pending = factory()
      .then(async (result) => {
        const entry: WorkspaceEntry = {
          workspace: result.workspace,
          refCount: 1,
          projectId,
          onDestroy: result.onDestroy,
          onDetach: result.onDetach,
        };
        const releaseMode = this.projectReleaseModes.get(projectId);
        if (releaseMode) {
          // Keep the entry registered so releaseAllForProject owns cleanup and
          // cannot report success if disposing this late acquisition fails.
          this.entries.set(key, entry);
          throw new Error(`Project workspace was disposed while being acquired: ${key}`);
        }

        this.entries.set(key, entry);
        result.onCreateSideEffect?.(result.workspace);
        try {
          await result.onCreate?.(result.workspace);
        } catch (error) {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          try {
            await this.disposeEntry(entry, 'terminate');
          } catch (cleanupError) {
            throw new WorkspaceCleanupError(`Workspace creation cleanup failed: ${key}`, [
              error,
              cleanupError,
            ]);
          }
          throw error;
        }

        const modeAfterCreate = this.projectReleaseModes.get(projectId);
        if (modeAfterCreate) {
          throw new Error(`Project workspace was disposed while being acquired: ${key}`);
        }
        return result.workspace;
      })
      .finally(() => {
        this.acquiring.delete(key);
      });

    this.acquiring.set(key, { projectId, promise: pending });
    return pending;
  }

  async release(key: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      const inFlight = this.acquiring.get(key);
      if (inFlight) {
        await inFlight.promise;
        await this.release(key, mode);
      }
      return;
    }

    if (entry.refCount > 1) {
      entry.refCount -= 1;
      return;
    }

    this.entries.delete(key);
    await this.disposeEntry(entry, mode);
  }

  get(key: string): Workspace | undefined {
    return this.entries.get(key)?.workspace;
  }

  listForProject(projectId: string): { workspaceId: string; path: string }[] {
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.projectId === projectId)
      .map(([workspaceId, entry]) => ({ workspaceId, path: entry.workspace.path }));
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refCount ?? 0;
  }

  async releaseAllForProject(projectId: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const existing = this.projectReleaseOperations.get(projectId);
    if (existing) return existing;

    const effectiveMode = this.projectReleaseModes.get(projectId) ?? mode;
    this.projectReleaseModes.set(projectId, effectiveMode);
    let completed = false;
    const operation = Promise.resolve()
      .then(async () => {
        const acquisitions = Array.from(this.acquiring.values())
          .filter((entry) => entry.projectId === projectId)
          .map((entry) => entry.promise);
        await Promise.allSettled(acquisitions);

        const entries = Array.from(this.entries.entries()).filter(
          ([, entry]) => entry.projectId === projectId
        );
        await runCleanupWithConcurrency(
          entries,
          PROJECT_WORKSPACE_DISPOSE_CONCURRENCY,
          async ([key, entry]) => {
            await this.disposeEntry(entry, effectiveMode);
            if (this.entries.get(key) === entry) this.entries.delete(key);
          }
        );
        completed = true;
      })
      .finally(() => {
        if (this.projectReleaseOperations.get(projectId) === operation) {
          this.projectReleaseOperations.delete(projectId);
          if (completed) this.projectReleaseModes.delete(projectId);
        }
      });
    this.projectReleaseOperations.set(projectId, operation);
    return operation;
  }

  async releaseAll(mode: TeardownMode = 'terminate'): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await runCleanupWithConcurrency(entries, PROJECT_WORKSPACE_DISPOSE_CONCURRENCY, (entry) =>
      this.disposeEntry(entry, mode)
    );
  }

  private async disposeEntry(entry: WorkspaceEntry, mode: TeardownMode): Promise<void> {
    const errors: unknown[] = [];
    if (mode === 'terminate') {
      try {
        await entry.onDestroy?.(entry.workspace);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      entry.workspace.git.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await entry.workspace.lifecycleService.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (mode === 'detach') {
      try {
        await entry.onDetach?.(entry.workspace);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new WorkspaceCleanupError(`Failed to dispose workspace: ${entry.workspace.id}`, errors);
    }
  }
}

export const workspaceRegistry = new WorkspaceRegistry();
