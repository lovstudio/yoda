import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { Conversation } from '@shared/conversations';
import type { Issue, Task, TaskLifecycleStatus, TaskSetupStatus } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { DraftCommentsStore } from '@renderer/features/tasks/diff-view/stores/draft-comments-store';
import { DevServerStore } from '@renderer/features/tasks/stores/dev-server-store';
import { TaskViewStore } from '@renderer/features/tasks/stores/task-view';
import type { WorkspaceStore } from '@renderer/features/tasks/stores/workspace';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { log } from '@renderer/utils/logger';

export type UnregisteredTaskPhase = 'creating' | 'create-error';

export type UnprovisionedTaskPhase =
  | 'naming'
  | 'naming-error'
  | 'provision'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle';

export type UnregisteredTaskData = {
  id: string;
  name: string;
  status: TaskLifecycleStatus;
  lastInteractedAt: string;
  createdAt: string;
  statusChangedAt: string;
  isPinned: boolean;
  needsReview: boolean;
  isUserNamed?: boolean;
  setupStatus?: TaskSetupStatus;
  setupError?: string;
  setupRequiresBranchName?: boolean;
  sidebarWorkspaceId?: string;
};

export class ProvisionedTask {
  readonly workspace: WorkspaceStore;
  readonly devServers: DevServerStore;
  readonly conversations: ConversationManagerStore;
  readonly terminals: TerminalManagerStore;
  readonly draftComments: DraftCommentsStore;
  readonly taskView: TaskViewStore;
  readonly repositoryStore: RepositoryStore;

  readonly _taskData: Task;
  readonly path: string;
  readonly workspaceId: string;

  private readonly _taskStore: TaskStore;
  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): TaskViewSnapshot {
    return this.taskView.snapshot;
  }

  get taskBranch(): string | undefined {
    return this._taskData.taskBranch;
  }

  get projectId(): string {
    return this._taskData.projectId;
  }

  get taskId(): string {
    return this._taskData.id;
  }

  constructor(
    taskStore: TaskStore,
    path: string,
    workspaceId: string,
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    savedSnapshot?: TaskViewSnapshot,
    sshConnectionId?: string,
    preloadedConversations?: Conversation[]
  ) {
    this._taskStore = taskStore;
    const taskData = taskStore.data as Task;
    this._taskData = taskData;
    this.path = path;
    this.workspaceId = workspaceId;

    this.workspace = workspaceRegistry.acquire(
      taskData.projectId,
      this.workspaceId,
      taskStore,
      settingsStore,
      baseRef,
      sshConnectionId
    );
    this.repositoryStore = this.workspace.repository;
    this.devServers = new DevServerStore(taskData.id, this.workspaceId);
    this.conversations = new ConversationManagerStore(
      taskData.projectId,
      taskData.id,
      preloadedConversations,
      (lastInteractedAt) => taskStore.recordUserPromptAt(lastInteractedAt)
    );
    this.terminals = new TerminalManagerStore(taskData.projectId, taskData.id);
    this.draftComments = new DraftCommentsStore(taskData.id);
    this.taskView = new TaskViewStore(
      {
        conversations: this.conversations,
        terminals: this.terminals,
        git: this.workspace.git,
        pr: this.workspace.pr,
        projectId: taskData.projectId,
        taskId: taskData.id,
        workspaceId: this.workspaceId,
      },
      savedSnapshot
    );

    makeAutoObservable(this, {
      workspace: false,
      devServers: false,
      conversations: false,
      terminals: false,
      draftComments: false,
      taskView: false,
      /** Owned by TaskStore.data — do not attach a second observable tree here */
      _taskData: false,
    });

    this._snapshotDisposer = snapshotRegistry.register(`task:${taskData.id}`, () => this.snapshot);
  }

  activate(): void {
    workspaceRegistry.activate(this._taskData.projectId, this.workspaceId);
  }

  dispose(): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    workspaceRegistry.release(this._taskData.projectId, this.workspaceId, this._taskStore);
    this.devServers.dispose();
    this.draftComments.dispose();
    this.taskView.dispose();
    this.conversations.dispose();
    for (const term of this.terminals.terminals.values()) {
      term.dispose();
    }
  }
}

export class TaskStore {
  state: 'unregistered' | 'unprovisioned' | 'provisioned';
  data: UnregisteredTaskData | Task;
  phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null;
  errorMessage: string | undefined = undefined;
  provisionedTask: ProvisionedTask | null = null;
  provisionProgressMessage: string | null = null;

  get displayName(): string {
    return this.data.name;
  }

  get isBootstrapping(): boolean {
    return (
      this.state === 'unregistered' ||
      (this.state === 'unprovisioned' &&
        (this.phase === 'naming' ||
          this.phase === 'naming-error' ||
          this.phase === 'provision' ||
          this.phase === 'provision-error'))
    );
  }

  constructor(
    data: UnregisteredTaskData | Task,
    state: TaskStore['state'],
    phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null = null
  ) {
    this.state = state;
    this.data = data;
    this.phase = phase;
    makeAutoObservable(this, {
      provisionedTask: observable.ref,
      /** Deep observable so nested fields (e.g. `status`) notify observers (e.g. sidebar). */
      data: observable,
    });
  }

  transitionToProvisioned(
    data: Task,
    path: string,
    workspaceId: string,
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    savedSnapshot?: TaskViewSnapshot,
    sshConnectionId?: string,
    preloadedConversations?: Conversation[]
  ): void {
    this.data = data;
    this.provisionedTask = new ProvisionedTask(
      this,
      path,
      workspaceId,
      settingsStore,
      baseRef,
      savedSnapshot,
      sshConnectionId,
      preloadedConversations
    );
    this.state = 'provisioned';
    this.phase = null;
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
  }

  transitionToUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
  }

  transitionToUnregistered(data: UnregisteredTaskData): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
    this.data = data;
    this.state = 'unregistered';
    this.phase = 'creating';
    this.errorMessage = undefined;
  }

  activate(): void {
    this.provisionedTask?.activate();
  }

  dispose(): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
  }

  recordUserPromptAt(lastInteractedAt: string): void {
    if (this.state === 'unregistered') return;
    this.data.lastInteractedAt = lastInteractedAt;
  }

  get conversationStats(): Record<string, number> {
    if (this.state === 'unregistered') {
      return {};
    }
    if (this.state === 'provisioned' && this.provisionedTask) {
      const counts: Record<string, number> = {};
      for (const conv of this.provisionedTask.conversations.conversations.values()) {
        const id = conv.data.runtimeId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    }
    return (this.data as Task).conversations;
  }

  async rename(name: string): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previousIsUserNamed = (this.data as Task).isUserNamed;
    try {
      await rpc.tasks.renameTask(task.projectId, task.id, name);
      runInAction(() => {
        this.data.name = name;
        (this.data as Task).isUserNamed = true;
      });
    } catch (e) {
      runInAction(() => {
        this.data.name = task.name;
        (this.data as Task).isUserNamed = previousIsUserNamed;
      });
      log.error(e);
      throw e;
    }
  }

  async updateStatus(status: TaskLifecycleStatus): Promise<void> {
    const previousStatus = this.data.status;
    const previousStatusChangedAt = this.data.statusChangedAt;
    const nextChangedAt = new Date().toISOString();
    runInAction(() => {
      this.data.status = status;
      this.data.statusChangedAt = nextChangedAt;
    });
    try {
      await rpc.tasks.updateTaskStatus(this.data.id, status);
    } catch (e) {
      runInAction(() => {
        this.data.status = previousStatus;
        this.data.statusChangedAt = previousStatusChangedAt;
      });
      log.error(e);
      throw e;
    }
  }

  async setPinned(isPinned: boolean): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previous = task.isPinned;
    runInAction(() => {
      task.isPinned = isPinned;
    });
    try {
      await rpc.tasks.setTaskPinned(task.id, isPinned);
    } catch (e) {
      runInAction(() => {
        task.isPinned = previous;
      });
      log.error(e);
      throw e;
    }
  }

  async setSidebarWorkspaceId(workspaceId: string | null): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previous = task.sidebarWorkspaceId;
    runInAction(() => {
      task.sidebarWorkspaceId = workspaceId ?? undefined;
    });
    try {
      await rpc.workspaces.assignTaskToWorkspace(task.id, workspaceId);
    } catch (e) {
      runInAction(() => {
        task.sidebarWorkspaceId = previous;
      });
      log.error(e);
      throw e;
    }
  }

  /**
   * Re-parent this task in the subtask tree. Optimistic; rolls back when the
   * main process rejects (cycle, cross-project, archived parent). Returns the
   * RPC result so callers can surface the rejection reason.
   */
  async setParentTask(
    parentTaskId: string | null
  ): Promise<Awaited<ReturnType<typeof rpc.tasks.setTaskParent>> | undefined> {
    if (this.state === 'unregistered') return undefined;
    const task = registeredTaskData(this);
    if (!task) return undefined;
    if ((task.parentTaskId ?? null) === parentTaskId) return undefined;
    const previous = task.parentTaskId;
    runInAction(() => {
      task.parentTaskId = parentTaskId ?? undefined;
    });
    try {
      const result = await rpc.tasks.setTaskParent(task.projectId, task.id, parentTaskId);
      if (!result.success) {
        runInAction(() => {
          task.parentTaskId = previous;
        });
      }
      return result;
    } catch (e) {
      runInAction(() => {
        task.parentTaskId = previous;
      });
      log.error(e);
      throw e;
    }
  }

  async setNeedsReview(needsReview: boolean): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    if (task.needsReview === needsReview) return;
    const previous = task.needsReview;
    runInAction(() => {
      task.needsReview = needsReview;
    });
    try {
      await rpc.tasks.setTaskNeedsReview(task.id, needsReview);
    } catch (e) {
      runInAction(() => {
        task.needsReview = previous;
      });
      log.error(e);
      throw e;
    }
  }

  async updateLinkedIssues(issues: Issue[]): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previousIssues = task.linkedIssues
      ? [...task.linkedIssues]
      : task.linkedIssue
        ? [task.linkedIssue]
        : [];
    const previousIssue = task.linkedIssue;
    try {
      await rpc.tasks.updateLinkedIssues(task.id, issues);
      runInAction(() => {
        task.linkedIssues = issues;
        task.linkedIssue = issues[0];
      });
    } catch (e) {
      runInAction(() => {
        task.linkedIssues = previousIssues;
        task.linkedIssue = previousIssue;
      });
      console.error(e);
      throw e;
    }
  }

  async updateLinkedIssue(issue?: Issue): Promise<void> {
    await this.updateLinkedIssues(issue ? [issue] : []);
  }

  async linkIssue(issue: Issue): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const current = task.linkedIssues ?? (task.linkedIssue ? [task.linkedIssue] : []);
    if (current.some((linked) => linked.url === issue.url)) return;
    await this.updateLinkedIssues([...current, issue]);
  }

  async unlinkIssue(issueUrl: string): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const current = task.linkedIssues ?? (task.linkedIssue ? [task.linkedIssue] : []);
    await this.updateLinkedIssues(current.filter((issue) => issue.url !== issueUrl));
  }
}

export type UnregisteredTask = TaskStore & {
  state: 'unregistered';
  data: UnregisteredTaskData;
  phase: UnregisteredTaskPhase;
  errorMessage: string | undefined;
};

export type UnprovisionedTask = TaskStore & {
  state: 'unprovisioned';
  data: Task;
  phase: UnprovisionedTaskPhase;
  errorMessage: string | undefined;
};

export function isUnregistered(t: TaskStore): t is UnregisteredTask {
  return t.state === 'unregistered';
}

export function isRegistered(
  t: TaskStore
): t is TaskStore & { state: 'unprovisioned' | 'provisioned'; data: Task } {
  return t.state !== 'unregistered';
}

export function isUnprovisioned(t: TaskStore): t is UnprovisionedTask {
  return t.state === 'unprovisioned';
}

export function isProvisioned(
  t: TaskStore
): t is TaskStore & { state: 'provisioned'; data: Task; provisionedTask: ProvisionedTask } {
  return t.state === 'provisioned';
}

/** Full `Task` payload when registered (unprovisioned or provisioned); `undefined` when unregistered. */
export function registeredTaskData(store: TaskStore): Task | undefined {
  return isRegistered(store) ? store.data : undefined;
}

export function unregisteredTaskData(store: TaskStore): UnregisteredTaskData | undefined {
  return isUnregistered(store) ? store.data : undefined;
}

export function createUnregisteredTask(data: UnregisteredTaskData): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating');
}

export function createUnprovisionedTask(data: Task): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle');
}
