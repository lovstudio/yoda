import { computed, makeObservable, observable, reaction, runInAction, toJS } from 'mobx';
import type { Conversation } from '@shared/conversations';
import { conversationMovedChannel } from '@shared/events/conversationEvents';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/events/prEvents';
import {
  taskArchivedChannel,
  taskCreatedChannel,
  taskDeletedChannel,
  taskMovedChannel,
  taskParadigmUpdatedChannel,
  taskProvisionProgressChannel,
  taskRenamedChannel,
  taskRestoredChannel,
  taskStatusUpdatedChannel,
} from '@shared/events/taskEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import {
  createTaskStrategyRequiresBranchName,
  type CreateTaskError,
  type CreateTaskParams,
  type CreateTaskWarning,
  type MoveTaskToProjectError,
  type ProjectTaskCounts,
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
import { publishAgentRuntimeStatusPreview } from '@renderer/lib/stores/agent-runtime-status-bridge';
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

function initialConversationStartsImmediately(
  initialConversation: CreateTaskParams['initialConversation']
): initialConversation is NonNullable<CreateTaskParams['initialConversation']> {
  if (!initialConversation || initialConversation.deferInitialPrompt) return false;
  return Boolean(
    initialConversation.initialPrompt?.trim() || initialConversation.imagePaths?.length
  );
}

function publishInitialConversationStatusPreview(
  initialConversation: NonNullable<CreateTaskParams['initialConversation']>,
  status: 'idle' | 'working'
): void {
  publishAgentRuntimeStatusPreview({
    projectId: initialConversation.projectId,
    taskId: initialConversation.taskId,
    conversationId: initialConversation.id,
    status,
  });
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

type TaskViewPreload = {
  savedSnapshot: TaskViewSnapshot | undefined;
};

type TaskViewPreloadEntry = {
  startedAt: number;
  promise: Promise<TaskViewPreload>;
};

const TASK_VIEW_PRELOAD_MAX_AGE_MS = 10_000;
const TASK_VIEW_PRELOAD_LIMIT = 4;
export const TASK_ENTRY_PRESENTATION_TIMEOUT_MS = 30_000;

function backgroundTaskOperationTimeoutMessage(operation: 'creation' | 'setup'): string {
  const seconds = Math.round(TASK_ENTRY_PRESENTATION_TIMEOUT_MS / 1000);
  return `Task ${operation} is still running after ${seconds}s. It will continue in the background.`;
}

export class TaskManagerStore {
  private readonly projectId: string;
  private readonly _repository: RepositoryStore;
  private readonly _settingsStore: ProjectSettingsStore;
  private readonly _baseRef: string;
  private _loadPromise: Promise<void> | null = null;
  private _archivedLoadPromise: Promise<void> | null = null;
  private _archivedLoadGeneration = 0;
  private _taskPointLoadPromises = new Map<string, Promise<boolean>>();
  private _taskCountsReloadPromise: Promise<void> | null = null;
  private _taskCountsReloadRequested = false;
  private _disposed = false;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();
  private _provisionTaskStores = new Map<string, TaskStore>();
  private _taskViewPreloads = new Map<string, TaskViewPreloadEntry>();
  private _prReloadPromise: Promise<void> | null = null;
  private _prReloadRequested = false;
  private _prUpdateRevision = 0;
  private _tasksByBranch = new Map<string, TaskStore[]>();

  private _unsubPrUpdated: (() => void) | null = null;
  private _unsubPrSyncProgress: (() => void) | null = null;
  private _unsubProvisionProgress: (() => void) | null = null;
  private _unsubConversationMoved: (() => void) | null = null;
  private _unsubTaskStatusUpdated: (() => void) | null = null;
  private _unsubTaskParadigmUpdated: (() => void) | null = null;
  private _unsubTaskCreated: (() => void) | null = null;
  private _unsubTaskArchived: (() => void) | null = null;
  private _unsubTaskRestored: (() => void) | null = null;
  private _unsubTaskDeleted: (() => void) | null = null;
  private _unsubTaskMoved: (() => void) | null = null;
  private _unsubTaskRenamed: (() => void) | null = null;
  private _disposeRepositoryReaction: (() => void) | null = null;
  private _disposeTaskBranchIndexReaction: (() => void) | null = null;

  tasks = observable.map<string, TaskStore>();
  taskLoadState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  /** Point-loaded task records that have not settled yet. */
  taskLoadPendingIds = observable.set<string>();
  archivedTaskLoadState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  taskCounts: Omit<ProjectTaskCounts, 'projectId'> = { active: 0, archived: 0 };
  /**
   * Tasks whose archive flow (pre-archive commands + conversation archives) is
   * in flight. Rows observe this to render a loading state while the task is
   * still visible in the sidebar.
   */
  archivingTaskIds = observable.set<string>();

  /**
   * Direct task-tree children indexed once per observable task-map snapshot.
   * Sidebar rows and task menus ask this question independently, so scanning
   * the full task map from each row turns a sidebar render into O(n²) work.
   */
  get childrenByParent(): ReadonlyMap<string, readonly TaskStore[]> {
    const childrenByParent = new Map<string, TaskStore[]>();
    for (const store of this.tasks.values()) {
      if (!isRegistered(store)) continue;
      const parentId = store.data.parentTaskId;
      if (!parentId) continue;
      const children = childrenByParent.get(parentId);
      if (children) {
        children.push(store);
      } else {
        childrenByParent.set(parentId, [store]);
      }
    }
    return childrenByParent;
  }

  /**
   * Tasks waiting for review, indexed by MobX instead of rescanned by every
   * runtime-bar render. The computed value still updates when a task is added,
   * archived, or its review marker changes, while unrelated task changes reuse
   * the cached result.
   */
  get tasksNeedingReview(): readonly TaskStore[] {
    const tasks: TaskStore[] = [];
    for (const store of this.tasks.values()) {
      if (!isRegistered(store)) continue;
      if (store.data.archivedAt || store.data.archiveRequestedAt || !store.data.needsReview) {
        continue;
      }
      tasks.push(store);
    }
    return tasks;
  }

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
    makeObservable(this, {
      tasks: observable,
      taskLoadState: observable,
      taskLoadPendingIds: observable,
      archivedTaskLoadState: observable,
      taskCounts: observable,
      archivingTaskIds: observable,
      childrenByParent: computed,
      tasksNeedingReview: computed,
    });

    this._disposeTaskBranchIndexReaction = reaction(
      () =>
        [...this.tasks.values()].flatMap((store) => {
          if (!isRegistered(store) || store.data.archivedAt || !store.data.taskBranch) return [];
          return [{ branch: store.data.taskBranch, store }];
        }),
      (entries) => {
        const tasksByBranch = new Map<string, TaskStore[]>();
        for (const { branch, store } of entries) {
          const stores = tasksByBranch.get(branch) ?? [];
          stores.push(store);
          tasksByBranch.set(branch, stores);
        }
        this._tasksByBranch = tasksByBranch;
      },
      { fireImmediately: true }
    );

    this._unsubTaskStatusUpdated = events.on(
      taskStatusUpdatedChannel,
      ({ taskId, projectId: evtProjectId, status }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (store && isRegistered(store)) {
          store.applyAuthoritativeStatus(status as TaskLifecycleStatus);
        }
      }
    );

    // A paradigm can be claimed by the main process (a Room started outside the
    // composer) or by another window, and task rows render their marker from it.
    this._unsubTaskParadigmUpdated = events.on(
      taskParadigmUpdatedChannel,
      ({ taskId, projectId: evtProjectId, paradigm }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (store && isRegistered(store)) store.applyAuthoritativeParadigm(paradigm);
      }
    );

    this._unsubTaskCreated = events.on(
      taskCreatedChannel,
      ({ taskId, projectId: evtProjectId }) => {
        if (evtProjectId !== this.projectId) return;
        void this.ensureTaskLoaded(taskId)
          .then(() => this.refreshTaskCounts())
          .catch((error: unknown) => {
            log.warn('TaskManagerStore: failed to reconcile externally created task', {
              taskId,
              projectId: evtProjectId,
              error,
            });
          });
      }
    );

    // Archives complete in the main process and may outlive the renderer that
    // initiated them (reload mid-archive) — reconcile from the event too.
    this._unsubTaskArchived = events.on(
      taskArchivedChannel,
      ({ taskId, projectId: evtProjectId }) => {
        if (evtProjectId !== this.projectId) return;
        this.setTaskArchiving(taskId, false);
        const store = this.tasks.get(taskId);
        if (store && isRegistered(store)) this._markLoadedTaskArchived(taskId);
        void this.refreshTaskCounts();
      }
    );

    this._unsubTaskRestored = events.on(
      taskRestoredChannel,
      ({ restoredTaskIds, projectId: evtProjectId }) => {
        if (evtProjectId !== this.projectId) return;
        void (async () => {
          if (restoredTaskIds.some((taskId) => !this.tasks.has(taskId))) {
            this._mergeLoadedTasks(await rpc.tasks.getTasksByIds(this.projectId, restoredTaskIds));
          }
          runInAction(() => {
            for (const taskId of restoredTaskIds) {
              const store = this.tasks.get(taskId);
              if (!store || !isRegistered(store)) continue;
              store.data.archivedAt = undefined;
              store.data.archiveRequestedAt = undefined;
            }
          });
          await this.refreshTaskCounts();
        })().catch((error: unknown) => {
          log.warn('TaskManagerStore: failed to reconcile restored tasks', {
            projectId: evtProjectId,
            taskIds: restoredTaskIds,
            error,
          });
        });
      }
    );

    this._unsubTaskDeleted = events.on(
      taskDeletedChannel,
      ({ taskId, projectId: evtProjectId, parentTaskId }) => {
        if (evtProjectId !== this.projectId) return;
        const removed = this.tasks.get(taskId);
        runInAction(() => {
          this.tasks.delete(taskId);
          for (const store of this.tasks.values()) {
            if (isRegistered(store) && store.data.parentTaskId === taskId) {
              store.data.parentTaskId = parentTaskId;
            }
          }
        });
        removed?.dispose();
        void this.refreshTaskCounts();
      }
    );

    this._unsubTaskMoved = events.on(
      taskMovedChannel,
      ({ taskId, sourceProjectId, targetProjectId }) => {
        if (sourceProjectId === this.projectId) {
          const removed = this.tasks.get(taskId);
          runInAction(() => {
            this.tasks.delete(taskId);
          });
          removed?.dispose();
          void this.refreshTaskCounts();
          return;
        }
        if (targetProjectId !== this.projectId) return;
        void this.ensureTaskLoaded(taskId)
          .then(() => this.refreshTaskCounts())
          .catch((error: unknown) => {
            log.warn('TaskManagerStore: failed to reconcile moved task', {
              taskId,
              sourceProjectId,
              targetProjectId,
              error,
            });
          });
      }
    );

    this._unsubTaskRenamed = events.on(
      taskRenamedChannel,
      ({ taskId, projectId: evtProjectId, name, isUserNamed }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (!store) return;
        runInAction(() => {
          store.data.name = name;
          store.data.isUserNamed = isUserNamed;
        });
      }
    );

    this._unsubConversationMoved = events.on(conversationMovedChannel, (event) => {
      const { conversation, sourceTaskId, targetTaskId } = event;
      if (conversation.projectId !== this.projectId) return;
      runInAction(() => {
        this.adjustStoredConversationCount(sourceTaskId, conversation.runtimeId, -1);
        this.adjustStoredConversationCount(targetTaskId, conversation.runtimeId, 1);
        const target = this.tasks.get(targetTaskId);
        if (target && isRegistered(target) && conversation.lastInteractedAt) {
          target.data.lastInteractedAt = conversation.lastInteractedAt;
        }
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
      let appliedUpdate = false;
      for (const pr of prs) {
        if (pr.repositoryUrl !== repoUrl) continue;
        appliedUpdate = true;
        for (const store of this._tasksByBranch.get(pr.headRefName) ?? []) {
          if (!isRegistered(store)) continue;
          const task = store.data as Task;
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
      if (appliedUpdate) {
        this._prUpdateRevision += 1;
        // If a bulk snapshot was already in flight, keep the incremental value
        // visible and schedule one trailing snapshot against the updated DB.
        if (this._prReloadPromise) this._prReloadRequested = true;
      }
    });

    this._unsubPrSyncProgress = events.on(prSyncProgressChannel, (progress) => {
      // Successful single-PR syncs already carry the fully assembled PR through
      // prUpdatedChannel, so only bulk sync completion needs a project snapshot.
      if (progress.status !== 'done' || progress.kind === 'single') return;
      const repoUrl = this._repository.repositoryUrl;
      if (!repoUrl || progress.remoteUrl !== repoUrl) return;
      void this._requestProjectPrReload();
    });

    this._disposeRepositoryReaction = reaction(
      () => this._repository.repositoryUrl,
      () => {
        this._clearTaskPrs();
        void this._requestProjectPrReload();
      }
    );
  }

  private _clearTaskPrs(): void {
    runInAction(() => {
      for (const store of this.tasks.values()) {
        if (isRegistered(store) && store.data.prs.length > 0) store.data.prs = [];
      }
    });
  }

  private _requestProjectPrReload(): Promise<void> {
    this._prReloadRequested = true;
    if (this._prReloadPromise) return this._prReloadPromise;

    const promise = this._drainProjectPrReloads().finally(() => {
      if (this._prReloadPromise === promise) this._prReloadPromise = null;
    });
    this._prReloadPromise = promise;
    return promise;
  }

  private async _drainProjectPrReloads(): Promise<void> {
    while (this._prReloadRequested && !this._disposed) {
      this._prReloadRequested = false;
      try {
        await this._reloadProjectPrsOnce();
      } catch (error) {
        log.warn('TaskManagerStore: failed to reload project task pull requests', {
          projectId: this.projectId,
          error,
        });
      }
    }
  }

  private async _reloadProjectPrsOnce(): Promise<void> {
    const repositoryUrl = this._repository.repositoryUrl;
    if (!repositoryUrl) {
      this._clearTaskPrs();
      return;
    }
    const updateRevision = this._prUpdateRevision;

    const result = await rpc.pullRequests.getPullRequestsForProjectTasks(
      this.projectId,
      repositoryUrl
    );
    if (
      !result.success ||
      this._disposed ||
      this._repository.repositoryUrl !== repositoryUrl ||
      this._prUpdateRevision !== updateRevision
    ) {
      return;
    }

    const prsByTaskId = new Map(
      result.data.taskPullRequests.map(({ taskId, prs }) => [taskId, prs])
    );
    runInAction(() => {
      for (const store of this.tasks.values()) {
        // Archive transition clears PRs once. Do not rewrite hundreds of
        // archived observable task objects after every background sync.
        if (!isRegistered(store) || store.data.archivedAt) continue;
        store.data.prs = [...(prsByTaskId.get(store.data.id) ?? [])];
      }
    });
  }

  private adjustStoredConversationCount(
    taskId: string,
    runtimeId: Conversation['runtimeId'],
    delta: number
  ): void {
    const store = this.tasks.get(taskId);
    if (!store || !isRegistered(store) || isProvisioned(store)) return;
    const current = store.data.conversations[runtimeId] ?? 0;
    store.data.conversations[runtimeId] = Math.max(0, current + delta);
  }

  loadTasks(): Promise<void> {
    if (this._disposed) return Promise.resolve();
    if (!this._loadPromise) {
      runInAction(() => {
        this.taskLoadState = 'loading';
      });
      this._loadPromise = Promise.all([
        rpc.tasks.getActiveTasks(this.projectId),
        this.refreshTaskCounts(),
      ])
        .then(([tasks]) => {
          this._mergeLoadedTasks(tasks);
          runInAction(() => {
            this.taskLoadState = 'loaded';
          });
        })
        .catch((e) => {
          runInAction(() => {
            this.taskLoadState = 'error';
          });
          console.error('Error loading tasks', e);
        });
    }
    return this._loadPromise;
  }

  loadArchivedTasks(): Promise<void> {
    if (this._disposed) return Promise.resolve();
    if (this.archivedTaskLoadState === 'loaded') return Promise.resolve();
    if (this._archivedLoadPromise) return this._archivedLoadPromise;

    const generation = this._archivedLoadGeneration;
    runInAction(() => {
      this.archivedTaskLoadState = 'loading';
    });
    const promise = this.loadTasks()
      .then(() => rpc.tasks.getArchivedTasks(this.projectId))
      .then((tasks) => {
        if (this._disposed || generation !== this._archivedLoadGeneration) return;
        this._mergeLoadedTasks(tasks);
        runInAction(() => {
          this.archivedTaskLoadState = 'loaded';
        });
      })
      .catch((error) => {
        if (!this._disposed && generation === this._archivedLoadGeneration) {
          runInAction(() => {
            this.archivedTaskLoadState = 'error';
          });
        }
        throw error;
      })
      .finally(() => {
        if (this._archivedLoadPromise === promise) this._archivedLoadPromise = null;
      });
    this._archivedLoadPromise = promise;
    return promise;
  }

  unloadArchivedTasks(): void {
    this._archivedLoadGeneration += 1;
    this._archivedLoadPromise = null;
    const removed: TaskStore[] = [];
    runInAction(() => {
      for (const [taskId, store] of this.tasks) {
        if (!isRegistered(store) || !store.data.archivedAt) continue;
        this.tasks.delete(taskId);
        removed.push(store);
      }
      this.archivedTaskLoadState = 'idle';
    });
    for (const store of removed) store.dispose();
  }

  /** Hydrate one bounded archive page owned by the sidebar priority view. */
  hydrateSidebarArchivedTasks(tasks: Task[]): string[] {
    const archivedTasks = tasks.filter(
      (task) => task.projectId === this.projectId && Boolean(task.archivedAt)
    );
    this._mergeLoadedTasks(archivedTasks);
    return archivedTasks.map((task) => task.id);
  }

  /** Release only sidebar-owned archive rows without disturbing the Archived tab lease. */
  releaseSidebarArchivedTasks(taskIds: readonly string[]): void {
    if (this.archivedTaskLoadState === 'loading' || this.archivedTaskLoadState === 'loaded') {
      return;
    }
    const removed: TaskStore[] = [];
    runInAction(() => {
      for (const taskId of taskIds) {
        const store = this.tasks.get(taskId);
        if (!store || !isRegistered(store) || !store.data.archivedAt) continue;
        this.tasks.delete(taskId);
        removed.push(store);
      }
    });
    for (const store of removed) store.dispose();
  }

  /**
   * Reconciles a task inserted after the initial project load, such as a
   * session imported by another local app immediately before a deep link.
   */
  async ensureTaskLoaded(taskId: string): Promise<boolean> {
    if (this._disposed) return false;
    if (this.tasks.has(taskId)) return true;
    const inFlight = this._taskPointLoadPromises.get(taskId);
    if (inFlight) return inFlight;

    runInAction(() => {
      this.taskLoadPendingIds.add(taskId);
    });
    const promise = this._ensureTaskLoaded(taskId).finally(() => {
      runInAction(() => {
        this.taskLoadPendingIds.delete(taskId);
        if (this._taskPointLoadPromises.get(taskId) === promise) {
          this._taskPointLoadPromises.delete(taskId);
        }
      });
    });
    this._taskPointLoadPromises.set(taskId, promise);
    return promise;
  }

  private async _ensureTaskLoaded(taskId: string): Promise<boolean> {
    await this.loadTasks();
    if (this._disposed) return false;
    if (this.tasks.has(taskId)) return true;

    const task = await rpc.tasks.getTask(this.projectId, taskId);
    if (!task || this._disposed) return false;
    this._mergeLoadedTasks([task]);
    return this.tasks.has(taskId);
  }

  refreshTaskCounts(): Promise<void> {
    this._taskCountsReloadRequested = true;
    if (this._taskCountsReloadPromise) return this._taskCountsReloadPromise;

    const promise = this._drainTaskCountsReloads().finally(() => {
      if (this._taskCountsReloadPromise === promise) this._taskCountsReloadPromise = null;
    });
    this._taskCountsReloadPromise = promise;
    return promise;
  }

  private async _drainTaskCountsReloads(): Promise<void> {
    while (this._taskCountsReloadRequested && !this._disposed) {
      this._taskCountsReloadRequested = false;
      try {
        const counts = await rpc.tasks.getTaskCounts(this.projectId);
        if (this._disposed) return;
        const projectCounts = counts.find((entry) => entry.projectId === this.projectId);
        runInAction(() => {
          this.taskCounts = projectCounts
            ? { active: projectCounts.active, archived: projectCounts.archived }
            : { active: 0, archived: 0 };
        });
      } catch (error) {
        log.warn('TaskManagerStore: failed to load project task counts', {
          projectId: this.projectId,
          error,
        });
      }
    }
  }

  private _mergeLoadedTasks(tasks: Task[]): void {
    if (this._disposed) return;
    let addedActiveTask = false;
    runInAction(() => {
      for (const task of tasks) {
        if (!this.tasks.has(task.id)) {
          this.tasks.set(task.id, createUnprovisionedTask(task));
          if (!task.archivedAt) addedActiveTask = true;
        }
        // An archive in flight in the main process (requested but not
        // finished, e.g. across a renderer reload) — show the spinner;
        // the task:archived event completes it.
        if (task.archiveRequestedAt && !task.archivedAt) this.archivingTaskIds.add(task.id);
      }
    });
    if (addedActiveTask) void this._requestProjectPrReload();
  }

  async createTask(params: CreateTaskParams) {
    const setupRequiresBranchName = createTaskStrategyRequiresBranchName(params.strategy);
    const initialConversation = params.initialConversation;
    const startsImmediately = initialConversationStartsImmediately(initialConversation);
    // Projectless (Drafts) tasks belong to the workspace they were created in;
    // tasks in a real project inherit the project's workspace in the sidebar.
    const sidebarWorkspaceId =
      params.sidebarWorkspaceId ??
      (this.projectId === INTERNAL_PROJECT_ID
        ? appState.workspaces.activeWorkspace?.id
        : undefined);
    const creatingTask = createUnregisteredTask({
      id: params.id,
      projectId: params.projectId,
      lastInteractedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      name: params.name,
      status: params.initialStatus ?? 'in_progress',
      statusChangedAt: new Date().toISOString(),
      isPinned: false,
      isFavorite: false,
      isLongTerm: false,
      needsReview: false,
      setupStatus: 'pending',
      setupRequiresBranchName,
      sidebarWorkspaceId,
      quickActionId: params.quickActionId,
      // Carried into the optimistic record so the sidebar draws the right paradigm
      // on the first frame, not once the DB row comes back.
      paradigmId: params.paradigm?.paradigmId,
      paradigmKind: params.paradigm?.paradigmKind,
      paradigmParams: params.paradigm?.paradigmParams,
    });
    // Submission intent is already authoritative enough for an immediate
    // renderer preview. Publish it before the task first enters the observable
    // map, so the sidebar can never classify this task through an idle frame.
    if (startsImmediately) {
      publishInitialConversationStatusPreview(initialConversation, 'working');
    }
    runInAction(() => {
      this.tasks.set(params.id, creatingTask);
    });

    const sourceBranch = structuredClone(toJS(params.sourceBranch));
    const presentationTimer = setTimeout(() => {
      runInAction(() => {
        const current = this.tasks.get(params.id);
        if (current !== creatingTask || !isUnregistered(current) || current.phase !== 'creating') {
          return;
        }
        current.phase = 'create-error';
        current.errorMessage = backgroundTaskOperationTimeoutMessage('creation');
      });
    }, TASK_ENTRY_PRESENTATION_TIMEOUT_MS);

    const result = await rpc.tasks
      .createTask({ ...params, sourceBranch, sidebarWorkspaceId })
      .catch((e: unknown) => {
        if (startsImmediately) {
          publishInitialConversationStatusPreview(initialConversation, 'idle');
        }
        // Network/IPC-level failure — surface as a generic error.
        const message = e instanceof Error ? e.message : String(e);
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current === creatingTask && isUnregistered(current)) {
            current.phase = 'create-error';
            current.errorMessage = message;
          }
        });
        throw e;
      })
      .finally(() => clearTimeout(presentationTimer));

    if (!result.success) {
      if (startsImmediately) {
        publishInitialConversationStatusPreview(initialConversation, 'idle');
      }
      const message = formatCreateTaskError(result.error);
      runInAction(() => {
        const current = this.tasks.get(params.id);
        if (current === creatingTask && isUnregistered(current)) {
          current.phase = 'create-error';
          current.errorMessage = message;
        }
      });
      throw new Error(message);
    }

    let didApplyCreateResult = false;
    runInAction(() => {
      const current = this.tasks.get(params.id);
      if (current === creatingTask && isUnregistered(current)) {
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
        didApplyCreateResult = true;
      }
    });
    if (!didApplyCreateResult) return;

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

  provisionTask(taskId: string): Promise<void> {
    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    // Publish the opening state before the first async boundary. A task can be
    // opened from the sidebar in the same event turn that provisioning starts;
    // exposing `provision` here prevents the route from painting an idle frame
    // before the shared opening surface takes ownership of the transition.
    const task = this.tasks.get(taskId);
    if (task && isUnprovisioned(task) && task.phase === 'idle') {
      runInAction(() => {
        if (isUnprovisioned(task) && task.phase === 'idle') {
          task.phase = 'provision';
        }
      });
    }
    if (task && isUnprovisioned(task)) {
      // Bind the presentation deadline before _provisionTask crosses its
      // mount/load awaits. A hung prerequisite must not leave the Logo with no
      // epoch to transition into the existing recovery surface.
      this._provisionTaskStores.set(taskId, task);
    }

    let presentationTimer: ReturnType<typeof setTimeout> | null = null;
    const promise = this._provisionTask(taskId).finally(() => {
      if (presentationTimer !== null) clearTimeout(presentationTimer);
      if (this._provisionPromises.get(taskId) === promise) {
        this._provisionPromises.delete(taskId);
        this._provisionTaskStores.delete(taskId);
      }
    });
    this._provisionPromises.set(taskId, promise);
    presentationTimer = setTimeout(() => {
      this.markProvisionPresentationTimedOut(taskId, promise, TASK_ENTRY_PRESENTATION_TIMEOUT_MS);
    }, TASK_ENTRY_PRESENTATION_TIMEOUT_MS);
    return promise;
  }

  /**
   * End only the renderer's opaque opening presentation. The epoch-bound RPC
   * keeps running and remains deduplicated; a late success can still publish
   * the provisioned task atomically, while a stale operation cannot mutate a
   * replacement TaskStore with the same id.
   */
  markProvisionPresentationTimedOut(
    taskId: string,
    provision: Promise<void>,
    timeoutMs: number
  ): boolean {
    if (this._provisionPromises.get(taskId) !== provision) return false;
    const current = this.tasks.get(taskId);
    if (
      !current ||
      this._provisionTaskStores.get(taskId) !== current ||
      !isUnprovisioned(current) ||
      current.phase !== 'provision'
    ) {
      return false;
    }

    let didMarkTimeout = false;
    runInAction(() => {
      if (
        this._provisionPromises.get(taskId) === provision &&
        this._provisionTaskStores.get(taskId) === current &&
        this.tasks.get(taskId) === current &&
        isUnprovisioned(current) &&
        current.phase === 'provision'
      ) {
        current.phase = 'provision-error';
        const seconds = Math.round(timeoutMs / 1000);
        current.errorMessage = `Task setup is still running after ${seconds}s. It will continue in the background.`;
        didMarkTimeout = true;
      }
    });
    return didMarkTimeout;
  }

  private async _provisionTask(taskId: string): Promise<void> {
    await getProjectManagerStore().mountProject(this.projectId);
    await this.loadTasks();

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;
    const expectedTask = this._provisionTaskStores.get(taskId);
    if (expectedTask && expectedTask !== task) return;
    if (!expectedTask) this._provisionTaskStores.set(taskId, task);

    if (task.phase !== 'provision') {
      runInAction(() => {
        if (isUnprovisioned(task)) task.phase = 'provision';
      });
    }

    const taskViewPreload = this._getTaskViewPreload(taskId);
    try {
      const [result, preload] = await Promise.all([
        rpc.tasks.provisionTask(taskId),
        taskViewPreload,
      ]);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current === task && isUnprovisioned(current) && !current.data.archivedAt) {
          current.transitionToProvisioned(
            { ...current.data },
            result.path,
            result.workspaceId,
            this._settingsStore,
            this._baseRef,
            preload.savedSnapshot,
            result.sshConnectionId ?? undefined,
            result.conversations
          );
          current.activate();
        }
      });
    } catch (err: unknown) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current === task && isUnprovisioned(current) && !current.data.archivedAt) {
          current.phase = 'provision-error';
          current.errorMessage = err instanceof Error ? err.message : String(err);
        }
      });
      throw err;
    } finally {
      const cached = this._taskViewPreloads.get(taskId);
      if (cached?.promise === taskViewPreload) {
        this._taskViewPreloads.delete(taskId);
      }
    }
  }

  /**
   * Preload the lightweight renderer data needed to materialize a task view.
   * Sidebar hover can safely call this without provisioning a workspace or
   * resuming agent/terminal processes; the next real open reuses the result.
   */
  async preloadTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task) || task.phase !== 'idle') return;

    const preload = this._getTaskViewPreload(taskId);
    try {
      await preload;
    } catch (error) {
      const cached = this._taskViewPreloads.get(taskId);
      if (cached?.promise === preload) {
        this._taskViewPreloads.delete(taskId);
      }
      log.warn('TaskManagerStore: failed to preload task view', { taskId, error });
    }
  }

  private _getTaskViewPreload(taskId: string): Promise<TaskViewPreload> {
    const now = Date.now();
    const cached = this._taskViewPreloads.get(taskId);
    if (cached && now - cached.startedAt <= TASK_VIEW_PRELOAD_MAX_AGE_MS) {
      // Refresh insertion order so the bounded cache behaves like an LRU.
      this._taskViewPreloads.delete(taskId);
      this._taskViewPreloads.set(taskId, cached);
      return cached.promise;
    }
    if (cached) this._taskViewPreloads.delete(taskId);

    const promise = viewStateCache.get(`task:${taskId}`).then((savedSnapshot) => ({
      savedSnapshot: savedSnapshot as TaskViewSnapshot | undefined,
    }));

    this._taskViewPreloads.set(taskId, { startedAt: now, promise });
    while (this._taskViewPreloads.size > TASK_VIEW_PRELOAD_LIMIT) {
      const oldestTaskId = this._taskViewPreloads.keys().next().value;
      if (oldestTaskId === undefined) break;
      this._taskViewPreloads.delete(oldestTaskId);
    }
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
   * When `parentTaskId` is provided, the task is re-homed and nested under that
   * destination-project task in the same RPC operation.
   * Tears down any live session, persists the move, then hands the task to the
   * destination project's manager so both sidebars reflect it without a reload.
   * Returns the error on failure, or null on success.
   */
  async moveTaskToProject(
    taskId: string,
    targetProjectId: string,
    parentTaskId: string | null = null
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

    const result = await rpc.tasks.moveTaskToProject(taskId, targetProjectId, parentTaskId);
    if (!result.success) return result.error;

    appState.agentRuntime.forgetTask(this.projectId, taskId);
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
        // A cross-window task:moved event may already have point-loaded this
        // task while the initiating RPC was in flight. Keep that canonical
        // store instead of replacing it without disposal.
        if (!targetManager.tasks.has(result.data.id)) {
          targetManager.tasks.set(result.data.id, createUnprovisionedTask(result.data));
        }
      });
      void targetManager.refreshTaskCounts();
    }
    void this.refreshTaskCounts();
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

  private _markLoadedTaskArchived(taskId: string, archiveNote?: string | null): void {
    const store = this.tasks.get(taskId);
    if (!store || !isRegistered(store)) return;
    const retainForArchivedView =
      this.archivedTaskLoadState === 'loading' || this.archivedTaskLoadState === 'loaded';
    runInAction(() => {
      const archivedData = {
        ...store.data,
        prs: [],
        archivedAt: store.data.archivedAt ?? new Date().toISOString(),
        ...(archiveNote !== undefined ? { archiveNote: archiveNote ?? undefined } : {}),
      };
      // Main owns the archive teardown. Dispose an existing renderer task view
      // immediately so a late provisioning completion cannot revive it.
      store.transitionToUnprovisioned(archivedData, 'idle');
      if (!retainForArchivedView) this.tasks.delete(taskId);
    });
    if (!retainForArchivedView) store.dispose();
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
      for (const id of archivedTaskIds) {
        this._markLoadedTaskArchived(id, id === taskId ? (nextNote ?? null) : undefined);
      }
      void this.refreshTaskCounts();
      if (!options.suppressUndoToast) this.showArchiveUndoToast(taskId);
    } finally {
      for (const id of cascadeIds) this.setTaskArchiving(id, false);
    }
  }

  /** Brief toast after archiving, offering a one-click restore of the same task. */
  private showArchiveUndoToast(taskId: string): void {
    const toastId = toast.success(i18n.t('sidebar.taskArchived'), {
      duration: 6000,
      persistNotification: false,
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
    const loaded = await this.ensureTaskLoaded(taskId);
    const task = this.tasks.get(taskId);
    if (!loaded || !task || !isRegistered(task)) {
      throw new Error(`Task ${taskId} could not be loaded`);
    }
    const archivedAt = task.data.archivedAt;

    try {
      const { restoredTaskIds } = await rpc.tasks.restoreTask(taskId);
      if (restoredTaskIds.some((id) => !this.tasks.has(id))) {
        this._mergeLoadedTasks(await rpc.tasks.getTasksByIds(this.projectId, restoredTaskIds));
      }
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
      // Archived tasks are intentionally excluded from project PR snapshots.
      // Rehydrate the restored cascade before callers continue opening it.
      await Promise.all([this._requestProjectPrReload(), this.refreshTaskCounts()]);
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
      appState.agentRuntime.forgetTask(this.projectId, taskId);
      await this.refreshTaskCounts();
    } catch (e) {
      runInAction(() => {
        this.tasks.set(taskId, task);
      });
      throw e;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._unsubTaskStatusUpdated?.();
    this._unsubTaskStatusUpdated = null;
    this._unsubTaskParadigmUpdated?.();
    this._unsubTaskParadigmUpdated = null;
    this._unsubTaskCreated?.();
    this._unsubTaskCreated = null;
    this._unsubTaskArchived?.();
    this._unsubTaskArchived = null;
    this._unsubTaskRestored?.();
    this._unsubTaskRestored = null;
    this._unsubTaskDeleted?.();
    this._unsubTaskDeleted = null;
    this._unsubTaskMoved?.();
    this._unsubTaskMoved = null;
    this._unsubTaskRenamed?.();
    this._unsubTaskRenamed = null;
    this._unsubPrUpdated?.();
    this._unsubPrUpdated = null;
    this._unsubPrSyncProgress?.();
    this._unsubPrSyncProgress = null;
    this._unsubProvisionProgress?.();
    this._unsubProvisionProgress = null;
    this._unsubConversationMoved?.();
    this._unsubConversationMoved = null;
    this._disposeRepositoryReaction?.();
    this._disposeRepositoryReaction = null;
    this._disposeTaskBranchIndexReaction?.();
    this._disposeTaskBranchIndexReaction = null;
    this._tasksByBranch.clear();
    this._prReloadRequested = false;
    this._prReloadPromise = null;
    this._taskViewPreloads.clear();
    this._loadPromise = null;
    this._archivedLoadGeneration += 1;
    this._archivedLoadPromise = null;
    this._taskPointLoadPromises.clear();
    this._taskCountsReloadRequested = false;
    this._taskCountsReloadPromise = null;
    this._teardownPromises.clear();
    this._provisionPromises.clear();
    this._provisionTaskStores.clear();
    for (const task of this.tasks.values()) task.dispose();
    runInAction(() => {
      this.tasks.clear();
      this.taskLoadPendingIds.clear();
      this.archivingTaskIds.clear();
      this.archivedTaskLoadState = 'idle';
      this.taskCounts = { active: 0, archived: 0 };
    });
  }
}
