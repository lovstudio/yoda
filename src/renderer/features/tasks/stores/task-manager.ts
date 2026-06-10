import { makeObservable, observable, reaction, runInAction, toJS } from 'mobx';
import type { Conversation } from '@shared/conversations';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/events/prEvents';
import {
  taskProvisionProgressChannel,
  taskRenamedChannel,
  taskStatusUpdatedChannel,
} from '@shared/events/taskEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import {
  createTaskStrategyRequiresBranchName,
  type CreateTaskError,
  type CreateTaskParams,
  type CreateTaskWarning,
  type Task,
  type TaskLifecycleStatus,
} from '@shared/tasks';
import type { TaskSidebarViewSnapshot, TaskViewSnapshot } from '@shared/view-state';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { TASK_SIDEBAR_VIEW_STATE_KEY } from '@renderer/features/tasks/stores/task-sidebar-preferences';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
  type TaskStore,
} from './task';

function phaseForSetupStatus(task: Task): 'naming' | 'naming-error' | 'provision' {
  switch (task.setupStatus) {
    case 'ready':
      return 'provision';
    case 'pending':
      return 'naming';
    case 'branch_failed':
    case 'naming_failed':
      return 'naming-error';
  }
}

function setupErrorMessage(task: Task): string | undefined {
  if (task.setupError) return task.setupError;
  switch (task.setupStatus) {
    case 'pending':
    case 'ready':
      return undefined;
    case 'branch_failed':
      return 'Branch setup failed.';
    case 'naming_failed':
      return task.setupRequiresBranchName
        ? 'Task name or branch name generation failed.'
        : 'Task name generation failed.';
  }
}

export async function markInitialConversationWorkingAfterProvision(
  task: TaskStore | undefined,
  initialConversation: CreateTaskParams['initialConversation']
): Promise<void> {
  if (!initialConversation?.initialPrompt?.trim()) return;
  if (!task || !isProvisioned(task)) return;
  try {
    await task.provisionedTask.conversations.markConversationWorking(initialConversation.id);
  } catch (error) {
    log.warn('TaskManagerStore: failed to mark initial conversation as working', {
      conversationId: initialConversation.id,
      taskId: initialConversation.taskId,
      error,
    });
  }
}

function formatCreateTaskError(error: CreateTaskError): string {
  switch (error.type) {
    case 'project-not-found':
      return 'Project not found.';
    case 'initial-commit-required':
      return 'Create an initial commit to enable branch-based tasks.';
    case 'branch-create-failed': {
      switch (error.error.type) {
        case 'already_exists':
          return `Branch "${error.error.name}" already exists. Try a different task name.`;
        case 'invalid_base':
          return `Source branch "${error.error.from}" is not a valid base. Check that it exists locally or on the selected remote.`;
        case 'invalid_name':
          return `Branch "${error.error.name}" is not a valid branch name.`;
        default:
          return `Could not create branch "${error.branch}": ${error.error.message}`;
      }
    }
    case 'pr-fetch-failed':
      return error.error.type === 'not_found'
        ? `PR #${error.error.prNumber} was not found on remote "${error.remote}".`
        : `Could not fetch the pull request branch: ${error.error.message}`;
    case 'branch-not-found':
      return `Branch "${error.branch}" was not found locally or on the remote. Make sure the PR branch exists.`;
    case 'worktree-setup-failed':
      return error.message
        ? `Could not set up the worktree for branch "${error.branch}": ${error.message}`
        : `Could not set up the worktree for branch "${error.branch}".`;
    case 'provision-failed':
      return `Task could not be provisioned: ${error.message}`;
    case 'provision-timeout': {
      const seconds = Math.round(error.timeoutMs / 1000);
      const stepLabel = (() => {
        switch (error.step) {
          case 'resolving-worktree':
            return 'resolving the worktree';
          case 'initialising-workspace':
            return 'initialising the workspace';
          case 'running-provision-script':
            return 'running the provision script';
          case 'connecting':
            return 'connecting to the workspace';
          case 'setting-up-workspace':
            return 'setting up the workspace';
          case 'starting-sessions':
            return 'starting sessions';
          case null:
            return null;
        }
      })();
      return stepLabel
        ? `Task setup timed out after ${seconds}s while ${stepLabel}.`
        : `Task setup timed out after ${seconds}s before any step started.`;
    }
  }
}

function formatCreateTaskWarning(warning: CreateTaskWarning): string {
  switch (warning.type) {
    case 'branch-publish-failed': {
      const detail =
        'message' in warning.error
          ? (warning.error.message ?? warning.error.type)
          : warning.error.type;
      return `Failed to publish branch "${warning.branch}" to "${warning.remote}": ${detail}`;
    }
    case 'task-naming-failed':
      return warning.blocksProvision
        ? `Task name generation failed: ${warning.message}`
        : `Task name generation failed; using the initial title: ${warning.message}`;
    case 'branch-setup-failed':
      return `Could not prepare branch "${warning.branch}": ${warning.message}`;
  }
}

function handleCreateTaskWarning(warning: CreateTaskWarning): void {
  if (warning.type === 'branch-publish-failed') {
    toast.error(formatCreateTaskWarning(warning));
    return;
  }
  log.warn('Task setup completed with warning', warning);
}

export class TaskManagerStore {
  private readonly projectId: string;
  private readonly _repository: RepositoryStore;
  private readonly _settingsStore: ProjectSettingsStore;
  private readonly _baseRef: string;
  private _loadPromise: Promise<void> | null = null;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();

  private _unsubPrUpdated: (() => void) | null = null;
  private _unsubPrSyncProgress: (() => void) | null = null;
  private _unsubProvisionProgress: (() => void) | null = null;
  private _disposeRepositoryReaction: (() => void) | null = null;

  tasks = observable.map<string, TaskStore>();
  /**
   * Tasks whose archive flow (pre-archive commands + conversation archives) is
   * in flight. Rows observe this to render a loading state while the task is
   * still visible in the sidebar.
   */
  archivingTaskIds = observable.set<string>();

  constructor(
    projectId: string,
    repository: RepositoryStore,
    settingsStore: ProjectSettingsStore,
    baseRef: string
  ) {
    this.projectId = projectId;
    this._repository = repository;
    this._settingsStore = settingsStore;
    this._baseRef = baseRef;
    makeObservable(this, { tasks: observable, archivingTaskIds: observable });

    events.on(taskStatusUpdatedChannel, ({ taskId, projectId: evtProjectId, status }) => {
      if (evtProjectId !== this.projectId) return;
      const store = this.tasks.get(taskId);
      if (store && isProvisioned(store)) {
        runInAction(() => {
          store.data.status = status as TaskLifecycleStatus;
        });
      }
    });

    events.on(taskRenamedChannel, ({ taskId, projectId: evtProjectId, name, isUserNamed }) => {
      if (evtProjectId !== this.projectId) return;
      const store = this.tasks.get(taskId);
      if (!store) return;
      runInAction(() => {
        store.data.name = name;
        store.data.isUserNamed = isUserNamed;
      });
    });

    this._unsubProvisionProgress = events.on(
      taskProvisionProgressChannel,
      ({ taskId, projectId: evtProjectId, message }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (store?.isBootstrapping) {
          runInAction(() => {
            store.provisionProgressMessage = message;
          });
        }
      }
    );

    this._unsubPrUpdated = events.on(prUpdatedChannel, ({ prs }) => {
      const repoUrl = this._repository.repositoryUrl;
      if (!repoUrl) return;
      for (const pr of prs) {
        if (pr.repositoryUrl !== repoUrl) continue;
        for (const [, store] of this.tasks) {
          if (!isRegistered(store)) continue;
          const task = store.data as Task;
          if (task.taskBranch !== pr.headRefName) continue;
          runInAction(() => {
            const idx = task.prs.findIndex((p) => p.url === pr.url);
            if (idx >= 0) {
              task.prs.splice(idx, 1, pr);
            } else {
              task.prs.push(pr);
            }
          });
        }
      }
    });

    this._unsubPrSyncProgress = events.on(prSyncProgressChannel, (progress) => {
      if (progress.status !== 'done') return;
      const repoUrl = this._repository.repositoryUrl;
      if (!repoUrl || progress.remoteUrl !== repoUrl) return;
      for (const [, store] of this.tasks) {
        if (isRegistered(store)) {
          void this._reloadPrsForTask(store);
        }
      }
    });

    this._disposeRepositoryReaction = reaction(
      () => this._repository.repositoryUrl,
      () => {
        for (const [, store] of this.tasks) {
          if (isRegistered(store)) {
            void this._reloadPrsForTask(store);
          }
        }
      }
    );
  }

  private async _reloadPrsForTask(store: TaskStore): Promise<void> {
    if (!isRegistered(store)) return;
    const result = await rpc.pullRequests.getPullRequestsForTask(this.projectId, store.data.id);
    if (!result.success) return;
    const prs = result.data.prs;
    runInAction(() => {
      if (isRegistered(store)) {
        (store.data as Task).prs = prs;
      }
    });
  }

  loadTasks(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = rpc.tasks
        .getTasks(this.projectId)
        .then((tasks) => {
          runInAction(() => {
            for (const t of tasks) {
              this.tasks.set(t.id, createUnprovisionedTask(t));
            }
          });
          const reloadPromises = tasks.flatMap((t) => {
            const store = this.tasks.get(t.id);
            return store && isRegistered(store) ? [this._reloadPrsForTask(store)] : [];
          });
          void Promise.all(reloadPromises);
        })
        .catch((e) => {
          console.error('Error loading tasks', e);
        });
    }
    return this._loadPromise;
  }

  async createTask(params: CreateTaskParams) {
    const setupRequiresBranchName = createTaskStrategyRequiresBranchName(params.strategy);
    // Projectless (Drafts) tasks belong to the workspace they were created in;
    // tasks in a real project inherit the project's workspace in the sidebar.
    const sidebarWorkspaceId =
      params.sidebarWorkspaceId ??
      (this.projectId === INTERNAL_PROJECT_ID
        ? appState.workspaces.activeWorkspace?.id
        : undefined);
    runInAction(() => {
      this.tasks.set(
        params.id,
        createUnregisteredTask({
          id: params.id,
          lastInteractedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          name: params.name,
          status: params.initialStatus ?? 'in_progress',
          statusChangedAt: new Date().toISOString(),
          isPinned: false,
          needsReview: false,
          setupStatus: 'pending',
          setupRequiresBranchName,
          sidebarWorkspaceId,
        })
      );
    });

    const sourceBranch = structuredClone(toJS(params.sourceBranch));

    const result = await rpc.tasks
      .createTask({ ...params, sourceBranch, sidebarWorkspaceId })
      .catch((e: unknown) => {
        // Network/IPC-level failure — surface as a generic error.
        const message = e instanceof Error ? e.message : String(e);
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current && isUnregistered(current)) {
            current.phase = 'create-error';
            current.errorMessage = message;
          }
        });
        throw e;
      });

    if (!result.success) {
      const message = formatCreateTaskError(result.error);
      runInAction(() => {
        const current = this.tasks.get(params.id);
        if (current && isUnregistered(current)) {
          current.phase = 'create-error';
          current.errorMessage = message;
        }
      });
      throw new Error(message);
    }

    runInAction(() => {
      const current = this.tasks.get(params.id);
      if (current && isUnregistered(current)) {
        const receivedRenameWhileCreating =
          current.data.name !== params.name || current.data.isUserNamed !== undefined;
        const task = receivedRenameWhileCreating
          ? {
              ...result.data.task,
              name: current.data.name,
              isUserNamed: current.data.isUserNamed ?? result.data.task.isUserNamed,
            }
          : result.data.task;
        const phase = phaseForSetupStatus(task);
        current.transitionToUnprovisioned(task, phase);
        if (phase === 'naming-error') {
          current.errorMessage = setupErrorMessage(task);
        }
      }
    });

    this._settingsStore.pageData.invalidate();

    if (result.data.warning) {
      handleCreateTaskWarning(result.data.warning);
    }

    if (result.data.task.setupStatus === 'ready') {
      await this.provisionTask(params.id);
      await markInitialConversationWorkingAfterProvision(
        this.tasks.get(params.id),
        params.initialConversation
      );
    }
  }

  async provisionTask(taskId: string): Promise<void> {
    await getProjectManagerStore().mountProject(this.projectId);
    await this.loadTasks();

    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    runInAction(() => {
      task.phase = 'provision';
    });

    const promise = Promise.all([
      rpc.tasks.provisionTask(taskId),
      viewStateCache.get(`task:${taskId}`),
      viewStateCache.get(TASK_SIDEBAR_VIEW_STATE_KEY),
      rpc.conversations.getConversationsForTask(this.projectId, taskId).catch((err: unknown) => {
        log.warn('TaskManagerStore: failed to pre-load conversations during provision', {
          taskId,
          error: err,
        });
        toast.error('Failed to load conversations');
        return [] as Conversation[];
      }),
    ])
      .then(([result, savedSnapshot, sharedSidebarSnapshot, preloadedConversations]) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.transitionToProvisioned(
              { ...current.data },
              result.path,
              result.workspaceId,
              this._settingsStore,
              this._baseRef,
              savedSnapshot as TaskViewSnapshot | undefined,
              sharedSidebarSnapshot as TaskSidebarViewSnapshot | undefined,
              result.sshConnectionId ?? undefined,
              preloadedConversations
            );
            current.activate();
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'provision-error';
            current.errorMessage = err instanceof Error ? err.message : String(err);
          }
        });
        throw err;
      })
      .finally(() => {
        this._provisionPromises.delete(taskId);
      });

    this._provisionPromises.set(taskId, promise);
    return promise;
  }

  async retryTaskSetup(taskId: string, manualBranchName?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;
    runInAction(() => {
      task.phase = 'naming';
      task.errorMessage = undefined;
      task.provisionProgressMessage = manualBranchName
        ? 'Preparing branch...'
        : task.data.setupRequiresBranchName
          ? 'Generating task name and branch...'
          : 'Generating task name...';
    });

    const result = await rpc.tasks.retryTaskSetup(this.projectId, taskId, manualBranchName);
    if (!result.success) {
      const message = formatCreateTaskError(result.error);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'naming-error';
          current.errorMessage = message;
        }
      });
      throw new Error(message);
    }

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isUnprovisioned(current)) {
        current.data = result.data.task;
        if (result.data.task.setupStatus === 'ready') {
          current.phase = 'provision';
          current.errorMessage = undefined;
        } else if (result.data.task.setupStatus === 'pending') {
          current.phase = 'naming';
          current.errorMessage = undefined;
        } else {
          current.phase = 'naming-error';
          current.errorMessage = setupErrorMessage(result.data.task);
        }
      }
    });

    if (result.data.warning) {
      handleCreateTaskWarning(result.data.warning);
    }

    if (result.data.task.setupStatus === 'ready') {
      await this.provisionTask(taskId);
    }
  }

  async regenerateTaskName(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const startedAt = Date.now();
    console.log('[DEBUG][task-manager] regenerateTaskName rpc start:', {
      projectId: this.projectId,
      taskId,
      currentName: task.data.name,
    });
    const result = await rpc.tasks.regenerateTaskName(this.projectId, taskId);
    console.log('[DEBUG][task-manager] regenerateTaskName rpc result:', {
      projectId: this.projectId,
      taskId,
      success: result.success,
      durationMs: Date.now() - startedAt,
      nextName: result.success ? result.data.name : undefined,
      error: result.success ? undefined : result.error.type,
    });
    if (!result.success) {
      throw new Error(formatCreateTaskError(result.error));
    }
    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isRegistered(current)) {
        current.data.name = result.data.name;
        current.data.isUserNamed = result.data.isUserNamed;
      }
    });
  }

  async teardownTask(taskId: string): Promise<void> {
    const inFlight = this._teardownPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task) return;

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (!current) return;
      if (isProvisioned(current)) {
        current.transitionToUnprovisioned({ ...current.data }, 'teardown');
      } else if (isUnprovisioned(current)) {
        current.phase = 'teardown';
      }
    });

    const promise = rpc.tasks
      .teardownTask(this.projectId, taskId)
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'idle';
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'teardown-error';
          }
        });
        throw err;
      })
      .finally(() => {
        this._teardownPromises.delete(taskId);
      });

    this._teardownPromises.set(taskId, promise);
    return promise;
  }

  async setTaskPinned(taskId: string, isPinned: boolean): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await task.setPinned(isPinned);
  }

  /**
   * Flip the task into the archived state locally without hitting the server.
   * Removes the row from the active sidebar immediately so a slow pre-archive
   * step never traps the row with a spinning icon. Returns a rollback that
   * restores the previous state (call it if the eventual server archive fails).
   */
  markTaskArchivedOptimistic(taskId: string, note?: string): () => void {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return () => {};
    const previousArchivedAt = currentTask.data.archivedAt;
    const previousArchiveNote = currentTask.data.archiveNote;
    const trimmedNote = note?.trim();
    const nextNote = trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;

    runInAction(() => {
      const task = this.tasks.get(taskId);
      if (task && isRegistered(task)) {
        task.data.archivedAt = new Date().toISOString();
        task.data.archiveNote = nextNote;
      }
    });

    return () => {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = previousArchivedAt;
          task.data.archiveNote = previousArchiveNote;
        }
      });
    };
  }

  setTaskArchiving(taskId: string, archiving: boolean): void {
    runInAction(() => {
      if (archiving) {
        this.archivingTaskIds.add(taskId);
      } else {
        this.archivingTaskIds.delete(taskId);
      }
    });
  }

  async archiveTask(taskId: string, note?: string): Promise<void> {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return;
    const trimmedNote = note?.trim();
    const nextNote = trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;

    const rollback = this.markTaskArchivedOptimistic(taskId, note);
    try {
      await rpc.tasks.archiveTask(this.projectId, taskId, nextNote);
    } catch (e) {
      rollback();
      throw e;
    }
  }

  async archiveActiveTasks(): Promise<void> {
    await this.loadTasks();
    const taskIds = Array.from(this.tasks.values()).flatMap((task) =>
      isRegistered(task) && !task.data.archivedAt ? [task.data.id] : []
    );
    await Promise.all(taskIds.map((taskId) => this.archiveTask(taskId)));
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const archivedAt = task.data.archivedAt;

    try {
      await rpc.tasks.restoreTask(taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = undefined;
        }
      });
    } catch (e) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = archivedAt;
        }
      });
      throw e;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    runInAction(() => {
      this.tasks.delete(taskId);
    });

    try {
      task.dispose();
      await rpc.tasks.deleteTask(this.projectId, taskId);
    } catch (e) {
      runInAction(() => {
        this.tasks.set(taskId, task);
      });
      throw e;
    }
  }

  dispose(): void {
    this._unsubPrUpdated?.();
    this._unsubPrUpdated = null;
    this._unsubPrSyncProgress?.();
    this._unsubPrSyncProgress = null;
    this._unsubProvisionProgress?.();
    this._unsubProvisionProgress = null;
    this._disposeRepositoryReaction?.();
    this._disposeRepositoryReaction = null;
  }
}
