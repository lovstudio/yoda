import { makeAutoObservable, observable, runInAction } from 'mobx';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

export type AgentRuntimeSnapshot = {
  /** Task ids the user has opened since their status last became attention-worthy. */
  seenTaskIds?: string[];
};

export type TaskAgentRuntimeSession = {
  conversationId: string;
  status: Exclude<AgentSessionRuntimeStatus, 'idle'>;
};

export type RunningAgentRuntimeSession = {
  projectId: string;
  taskId: string;
  conversationId: string;
  status: Extract<AgentSessionRuntimeStatus, 'working' | 'awaiting-input'>;
};

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\0${taskId}`;
}

function taskKeyFromStatusKey(statusKey: string): string {
  return statusKey.slice(0, statusKey.lastIndexOf('\0'));
}

/** Statuses that mean "the agent wants the user's attention" (unread candidates). */
function isAttentionStatus(status: AgentSessionRuntimeStatus): boolean {
  return status === 'awaiting-input' || status === 'completed' || status === 'error';
}

/**
 * Global, mount-independent mirror of the main-process agent run-state store.
 *
 * The per-task `ConversationManagerStore` hydrates persisted status only when a
 * task is mounted. This store cold-loads only sessions with a live main-process
 * or tmux marker and keeps them live via
 * {@link agentSessionStatusChangedChannel}. It never mounts task views or parses
 * every historical transcript.
 *
 * Aggregation mirrors `ConversationManagerStore.taskStatus`: a task is "working"
 * if any of its conversations is working; "awaiting-input"/"error"/"completed"
 * surface when present.
 */
export class AgentRuntimeStore {
  /** conversationKey -> status, where conversationKey = `${projectId}\0${taskId}\0${conversationId}`. */
  private statuses = observable.map<string, AgentSessionRuntimeStatus>();
  /** Task ids the user has opened; cleared for a task when it re-enters an attention status. */
  private seenTaskIds = observable.set<string>();
  /** Active/attention session keys grouped by task, avoiding a global scan per sidebar row. */
  private statusKeysByTask = observable.map<string, Set<string>>();
  /** Per-entry ordering guard so a slow hydration response cannot beat a live event. */
  private statusRevisions = new Map<string, number>();
  private revision = 0;
  /** Revision tombstones only need to live while one or more snapshots are in flight. */
  private pendingHydrations = 0;
  /** Enabled only by the primary app window; warm/detached windows stay passive. */
  private projectHydrationEnabled = false;
  private off: (() => void) | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  async start(): Promise<void> {
    if (this.off) return;
    this.off = events.on(agentSessionStatusChangedChannel, (event) => {
      this.applyStatus(event.projectId, event.taskId, event.conversationId, event.status);
    });
  }

  /** Cold-load active local sessions for the primary app shell. */
  async hydrateActiveSessions(): Promise<void> {
    this.projectHydrationEnabled = true;
    await this.hydrate();
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    this.projectHydrationEnabled = false;
    this.statuses.clear();
    this.seenTaskIds.clear();
    this.statusKeysByTask.clear();
    this.statusRevisions.clear();
  }

  private applyStatus(
    projectId: string,
    taskId: string,
    conversationId: string,
    status: AgentSessionRuntimeStatus,
    markAttentionUnread = true
  ): void {
    const key = `${taskKey(projectId, taskId)}\0${conversationId}`;
    runInAction(() => {
      this.applyStatusInAction(key, status);
      if (this.pendingHydrations > 0) {
        this.statusRevisions.set(key, ++this.revision);
      }
      // A task re-entering an attention status is "unread" again until reopened.
      if (markAttentionUnread && isAttentionStatus(status)) {
        this.seenTaskIds.delete(taskKey(projectId, taskId));
      }
    });
  }

  private applyStatusInAction(key: string, status: AgentSessionRuntimeStatus): void {
    if (status === 'idle') {
      this.removeStatus(key);
      return;
    }

    const task = taskKeyFromStatusKey(key);
    let keys = this.statusKeysByTask.get(task);
    if (!keys) {
      keys = observable.set<string>();
      this.statusKeysByTask.set(task, keys);
    }
    this.statuses.set(key, status);
    keys.add(key);
  }

  private removeStatus(key: string): void {
    this.statuses.delete(key);
    const task = taskKeyFromStatusKey(key);
    const keys = this.statusKeysByTask.get(task);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) this.statusKeysByTask.delete(task);
  }

  /** Re-scan one mounted remote project's host after its SSH context is ready. */
  async hydrateProject(projectId: string): Promise<void> {
    if (!this.projectHydrationEnabled) return;
    await this.hydrate(projectId);
  }

  private async hydrate(projectId?: string): Promise<void> {
    const baselineRevision = this.revision;
    this.pendingHydrations += 1;
    try {
      const snapshot = await rpc.conversations.getActiveRuntimeStatuses(projectId);
      const returnedKeys = new Set(
        snapshot.entries.map(
          (entry) => `${taskKey(entry.projectId, entry.taskId)}\0${entry.conversationId}`
        )
      );
      const coveredProjects = new Set(snapshot.coveredProjectIds);

      runInAction(() => {
        for (const key of this.statuses.keys()) {
          const projectKey = key.slice(0, key.indexOf('\0'));
          if (!coveredProjects.has(projectKey) || returnedKeys.has(key)) continue;
          if ((this.statusRevisions.get(key) ?? 0) > baselineRevision) continue;
          this.removeStatus(key);
          this.statusRevisions.set(key, ++this.revision);
        }

        for (const entry of snapshot.entries) {
          const key = `${taskKey(entry.projectId, entry.taskId)}\0${entry.conversationId}`;
          if ((this.statusRevisions.get(key) ?? 0) > baselineRevision) continue;
          this.applyStatusInAction(key, entry.status);
          this.statusRevisions.set(key, ++this.revision);
        }
      });
    } catch (error) {
      log.warn('[agent-runtime] active status hydration failed:', {
        projectId,
        error,
      });
    } finally {
      this.pendingHydrations -= 1;
      if (this.pendingHydrations === 0) this.statusRevisions.clear();
    }
  }

  /** Aggregate status for a task, mirroring `ConversationManagerStore.taskStatus`. */
  taskStatus(projectId: string, taskId: string): AgentSessionRuntimeStatus | null {
    const task = taskKey(projectId, taskId);
    let hasWorking = false;
    let hasAwaiting = false;
    let hasError = false;
    let hasCompleted = false;
    for (const key of this.statusKeysByTask.get(task) ?? []) {
      const status = this.statuses.get(key);
      if (!status) continue;
      if (status === 'working') hasWorking = true;
      else if (status === 'awaiting-input') hasAwaiting = true;
      else if (status === 'error') hasError = true;
      else if (status === 'completed') hasCompleted = true;
    }
    if (hasAwaiting) return 'awaiting-input';
    if (hasWorking) return 'working';
    if (hasError) return 'error';
    if (hasCompleted) return 'completed';
    return null;
  }

  /**
   * Session-level states worth showing in a task's status manager. Running and
   * awaiting-input sessions always remain visible; terminal states are
   * notification-like and disappear once the task has been consumed.
   */
  taskSessionStatuses(projectId: string, taskId: string): TaskAgentRuntimeSession[] {
    const task = taskKey(projectId, taskId);
    const prefix = `${task}\0`;
    const unread = !this.seenTaskIds.has(task);
    const sessions: TaskAgentRuntimeSession[] = [];
    for (const key of this.statusKeysByTask.get(task) ?? []) {
      const status = this.statuses.get(key);
      if (!status || status === 'idle') continue;
      if ((status === 'error' || status === 'completed') && !unread) continue;
      sessions.push({ conversationId: key.slice(prefix.length), status });
    }
    return sessions;
  }

  /** Conversation ids of this task whose sessions are currently `working`. */
  workingConversationIds(projectId: string, taskId: string): string[] {
    const task = taskKey(projectId, taskId);
    const prefix = `${task}\0`;
    const ids: string[] = [];
    for (const key of this.statusKeysByTask.get(task) ?? []) {
      if (this.statuses.get(key) === 'working') ids.push(key.slice(prefix.length));
    }
    return ids;
  }

  /**
   * Return the mount-independent status for one conversation when it is still
   * active or has an unread terminal notification. Idle sessions are removed
   * from the active index, so callers can fall back to mounted conversation
   * metadata when this returns null.
   */
  sessionStatus(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Exclude<AgentSessionRuntimeStatus, 'idle'> | null {
    const task = taskKey(projectId, taskId);
    const status = this.statuses.get(`${task}\0${conversationId}`) ?? null;
    if (!status || status === 'idle') return null;
    if ((status === 'error' || status === 'completed') && this.seenTaskIds.has(task)) {
      return null;
    }
    return status;
  }

  /** Every globally tracked session that is currently working or waiting for user input. */
  runningSessions(): RunningAgentRuntimeSession[] {
    const sessions: RunningAgentRuntimeSession[] = [];
    for (const [key, status] of this.statuses) {
      if (status !== 'working' && status !== 'awaiting-input') continue;
      const [projectId, taskId, conversationId] = key.split('\0');
      if (!projectId || !taskId || !conversationId) continue;
      sessions.push({ projectId, taskId, conversationId, status });
    }
    return sessions.sort((left, right) => {
      if (left.status !== right.status) return left.status === 'awaiting-input' ? -1 : 1;
      return (
        left.projectId.localeCompare(right.projectId) ||
        left.taskId.localeCompare(right.taskId) ||
        left.conversationId.localeCompare(right.conversationId)
      );
    });
  }

  isTaskRunning(projectId: string, taskId: string): boolean {
    const status = this.taskStatus(projectId, taskId);
    return status !== null && isAgentSessionRunningStatus(status);
  }

  /** A task is unread when it has an attention-worthy status and hasn't been opened. */
  isTaskUnread(projectId: string, taskId: string): boolean {
    return this.taskSessionStatuses(projectId, taskId).some(({ status }) =>
      isAttentionStatus(status)
    );
  }

  markTaskSeen(projectId: string, taskId: string): void {
    runInAction(() => this.seenTaskIds.add(taskKey(projectId, taskId)));
  }

  /** Drop acknowledgement state when a task leaves the local project graph. */
  forgetTask(projectId: string, taskId: string): void {
    runInAction(() => this.seenTaskIds.delete(taskKey(projectId, taskId)));
  }

  /** Drop acknowledgement state for every task removed with a project. */
  forgetProject(projectId: string): void {
    const prefix = `${projectId}\0`;
    runInAction(() => {
      for (const key of this.seenTaskIds) {
        if (key.startsWith(prefix)) this.seenTaskIds.delete(key);
      }
    });
  }

  get snapshot(): AgentRuntimeSnapshot {
    return { seenTaskIds: [...this.seenTaskIds] };
  }

  restoreSnapshot(snapshot: Partial<AgentRuntimeSnapshot>): void {
    if (snapshot.seenTaskIds !== undefined) {
      this.seenTaskIds.replace(snapshot.seenTaskIds);
    }
  }
}
