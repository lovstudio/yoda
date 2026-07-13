import { makeObservable, observable, reaction, runInAction, toJS } from 'mobx';
import type { Conversation } from '@shared/conversations';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/events/prEvents';
import {
  taskArchivedChannel,
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
  type MoveTaskToProjectError,
  type Task,
  type TaskLifecycleStatus,
} from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
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
  if (initialConversation?.deferInitialPrompt) return;
  if (!initialConversation?.initialPrompt?.trim() && !initialConversation?.imagePaths?.length)
    return;
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

    // Archives complete in the main process and may outlive the renderer that
    // initiated them (reload mid-archive) — reconcile from the event too.
    events.on(taskArchivedChannel, ({ taskId, projectId: evtProjectId }) => {
      if (evtProjectId !== this.projectId) return;
      this.setTaskArchiving(taskId, false);
      const store = this.tasks.get(taskId);
      if (store && isRegistered(store) && !store.data.archivedAt) {
        runInAction(() => {
          store.data.archivedAt = new Date().toISOString();
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
              // An archive in flight in the main process (requested but not
              // finished, e.g. across a renderer reload) — show the spinner;
              // the task:archived event completes it.
              if (t.archiveRequestedAt && !t.archivedAt) this.archivingTaskIds.add(t.id);
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
      rpc.conversations.getConversationsForTask(this.projectId, taskId).catch((err: unknown) => {
        log.warn('TaskManagerStore: failed to pre-load conversations during provision', {
          taskId,
          error: err,
        });
        toast.error('Failed to load conversations');
        return [] as Conversation[];
      }),
    ])
      .then(([result, savedSnapshot, preloadedConversations]) => {
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
   * Re-home this task under another project (move / "promote" a Default task).
   * Tears down any live session, persists the move, then hands the task to the
   * destination project's manager so both sidebars reflect it without a reload.
   * Returns the error on failure, or null on success.
   */
  async moveTaskToProject(
    taskId: string,
    targetProjectId: string
  ): Promise<MoveTaskToProjectError | null> {
    const task = this.tasks.get(taskId);
    if (!task) return { type: 'task-not-found' };

    // Stop a running/booting session before the rows move; the main process
    // also tears down defensively, but doing it here keeps this store's view in
    // sync (the task leaves as unprovisioned). Skip it for worktree tasks: the
    // main process must commit + push the worktree's changes before teardown
    // removes it, so it owns the teardown ordering in that path.
    const hasWorktree =
      isRegistered(task) && 'taskBranch' in task.data && Boolean(task.data.taskBranch);
    if (!hasWorktree && (isProvisioned(task) || (isUnprovisioned(task) && task.phase !== 'idle'))) {
      await this.teardownTask(taskId).catch(() => {});
    }

    const result = await rpc.tasks.moveTaskToProject(taskId, targetProjectId);
    if (!result.success) return result.error;

    const store = this.tasks.get(taskId);
    runInAction(() => {
      this.tasks.delete(taskId);
    });
    store?.dispose();

    await getProjectManagerStore().mountProject(targetProjectId);
    const targetManager =
      getProjectManagerStore().projects.get(targetProjectId)?.mountedProject?.taskManager;
    if (targetManager) {
      await targetManager.loadTasks();
      runInAction(() => {
        targetManager.tasks.set(result.data.id, createUnprovisionedTask(result.data));
      });
    }
    return null;
  }

  /**
   * All locally-known descendant task ids of `taskId` (children first, then
   * grandchildren, ...). Built from the in-memory parentTaskId adjacency.
   */
  getDescendantTaskIds(taskId: string): string[] {
    const childrenByParent = new Map<string, string[]>();
    for (const store of this.tasks.values()) {
      if (!isRegistered(store)) continue;
      const parentId = store.data.parentTaskId;
      if (!parentId) continue;
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(store.data.id);
      childrenByParent.set(parentId, siblings);
    }
    const result: string[] = [];
    const queue = [...(childrenByParent.get(taskId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (result.includes(id)) continue; // dirty-data cycle guard
      result.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return result;
  }

  setTaskArchiving(taskId: string, archiving: boolean): void {
    runInAction(() => {
      const store = this.tasks.get(taskId);
      if (archiving) {
        this.archivingTaskIds.add(taskId);
        // Mirror what the main process persists (archive_requested_at) so
        // data-driven consumers — the sidebar's "archiving last" demote rule —
        // see the in-flight archive without a renderer reload.
        if (store && isRegistered(store) && !store.data.archiveRequestedAt) {
          store.data.archiveRequestedAt = new Date().toISOString();
        }
      } else {
        this.archivingTaskIds.delete(taskId);
        // Failed/cancelled archive: clear the mirror so the task stops sinking.
        // A completed archive keeps it (the row leaves the sidebar anyway).
        if (store && isRegistered(store) && !store.data.archivedAt) {
          store.data.archiveRequestedAt = undefined;
        }
      }
    });
  }

  async archiveTask(
    taskId: string,
    options: {
      note?: string;
      skipPreCommand?: boolean;
      preArchiveCommand?: string;
      suppressUndoToast?: boolean;
    } = {}
  ): Promise<void> {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return;
    const trimmedNote = options.note?.trim();
    const nextNote = trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined;

    // Cascade spinner over locally-known descendants while the server archives
    // them. The rows stay visible (dimmed, spinning) until the main-process
    // flow — pre-archive command included — finishes; only then do they leave
    // the sidebar. Mirrors the reload-resume path in loadTasks.
    const cascadeIds = this.getDescendantTaskIds(taskId);
    for (const id of cascadeIds) this.setTaskArchiving(id, true);

    try {
      const { archivedTaskIds } = await rpc.tasks.archiveTask(this.projectId, taskId, nextNote, {
        skipPreCommand: options.skipPreCommand,
        preArchiveCommand: options.preArchiveCommand,
      });
      // Reconcile: the server is authoritative on the cascaded set (it may know
      // descendants this renderer hasn't loaded or had stale parents for).
      runInAction(() => {
        for (const id of archivedTaskIds) {
          const store = this.tasks.get(id);
          if (store && isRegistered(store) && !store.data.archivedAt) {
            store.data.archivedAt = new Date().toISOString();
            if (id === taskId) store.data.archiveNote = nextNote;
          }
        }
      });
      if (!options.suppressUndoToast) this.showArchiveUndoToast(taskId);
    } finally {
      for (const id of cascadeIds) this.setTaskArchiving(id, false);
    }
  }

  /** Brief toast after archiving, offering a one-click restore of the same task. */
  private showArchiveUndoToast(taskId: string): void {
    const toastId = toast.success(i18n.t('sidebar.taskArchived'), {
      duration: 6000,
      action: {
        label: i18n.t('common.undo'),
        onClick: () => {
          toast.dismiss(toastId);
          void this.restoreTask(taskId).catch((e: unknown) => {
            toast.error(e instanceof Error ? e.message : String(e), {
              description: i18n.t('sidebar.archiveTask'),
            });
          });
        },
      },
    });
  }

  async archiveActiveTasks(): Promise<void> {
    await this.loadTasks();
    const taskIds = Array.from(this.tasks.values()).flatMap((task) =>
      isRegistered(task) && !task.data.archivedAt ? [task.data.id] : []
    );
    await Promise.all(
      taskIds.map((taskId) => this.archiveTask(taskId, { suppressUndoToast: true }))
    );
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const archivedAt = task.data.archivedAt;

    try {
      const { restoredTaskIds } = await rpc.tasks.restoreTask(taskId);
      // Restore cascades over archived descendants on the server — mirror it.
      runInAction(() => {
        for (const id of restoredTaskIds) {
          const current = this.tasks.get(id);
          if (current && isRegistered(current)) {
            current.data.archivedAt = undefined;
            // The server clears the archive intent on restore — mirror it so
            // the task is not treated as archiving (sidebar demote rule).
            current.data.archiveRequestedAt = undefined;
          }
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

    // Mirror the server: children are reparented to the grandparent, not deleted.
    const grandparentId = isRegistered(task) ? task.data.parentTaskId : undefined;
    runInAction(() => {
      for (const store of this.tasks.values()) {
        if (isRegistered(store) && store.data.parentTaskId === taskId) {
          store.data.parentTaskId = grandparentId;
        }
      }
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
