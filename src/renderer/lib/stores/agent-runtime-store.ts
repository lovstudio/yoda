import { makeAutoObservable, observable, runInAction } from 'mobx';
import { deriveAgentDisplayStatus, type AgentDisplayStatus } from '@shared/agent-background-jobs';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { subscribeAgentRuntimeStatusPreview } from './agent-runtime-status-bridge';

export type AgentRuntimeSnapshot = {
  /** Task ids the user has opened since their status last became attention-worthy. */
  seenTaskIds?: string[];
};

export type TaskAgentRuntimeSession = {
  conversationId: string;
  status: Exclude<AgentDisplayStatus, 'idle'>;
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

/**
 * Statuses that mean "the agent wants the user's attention" (unread candidates).
 * `background` is deliberately absent: a detached job is work in progress, not
 * something the user is being asked to look at.
 */
function isAttentionStatus(status: AgentDisplayStatus): boolean {
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
  /**
   * conversationKey -> number of still-running detached jobs. Kept apart from
   * {@link statuses} on purpose: that map encodes `idle` as "no entry", and an
   * idle session that still owns a background job is exactly the case this
   * feature exists for — storing it there would erase it. Zero deletes the key.
   */
  private backgroundCounts = observable.map<string, number>();
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
  private offPreview: (() => void) | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  async start(): Promise<void> {
    if (this.off) return;
    this.off = events.on(agentSessionStatusChangedChannel, (event) => {
      this.applyStatus(
        event.projectId,
        event.taskId,
        event.conversationId,
        event.status,
        event.backgroundJobCount
      );
    });
    // Renderer-side predictions carry no job information; `undefined` leaves the
    // last known count alone rather than optimistically clearing it.
    this.offPreview = subscribeAgentRuntimeStatusPreview((event) => {
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
    this.offPreview?.();
    this.offPreview = null;
    this.projectHydrationEnabled = false;
    this.statuses.clear();
    this.backgroundCounts.clear();
    this.seenTaskIds.clear();
    this.statusKeysByTask.clear();
    this.statusRevisions.clear();
  }

  private applyStatus(
    projectId: string,
    taskId: string,
    conversationId: string,
    status: AgentSessionRuntimeStatus,
    backgroundJobCount?: number,
    markAttentionUnread = true
  ): void {
    const key = `${taskKey(projectId, taskId)}\0${conversationId}`;
    runInAction(() => {
      // Counts first: index membership below depends on them.
      if (backgroundJobCount !== undefined) {
        if (backgroundJobCount > 0) this.backgroundCounts.set(key, backgroundJobCount);
        else this.backgroundCounts.delete(key);
      }
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
    if (status === 'idle') this.statuses.delete(key);
    else this.statuses.set(key, status);
    this.reindex(key);
  }

  private removeStatus(key: string): void {
    this.statuses.delete(key);
    this.reindex(key);
  }

  /**
   * A conversation stays in the per-task index while it has anything worth
   * showing. Background jobs count on their own: an `idle` session holds no
   * entry in {@link statuses}, and dropping it from the index would hide the one
   * case this feature exists for — a finished turn with live detached work.
   */
  private reindex(key: string): void {
    const task = taskKeyFromStatusKey(key);
    const tracked = this.statuses.has(key) || this.backgroundCounts.has(key);
    const keys = this.statusKeysByTask.get(task);
    if (!tracked) {
      if (!keys) return;
      keys.delete(key);
      if (keys.size === 0) this.statusKeysByTask.delete(task);
      return;
    }
    if (keys) keys.add(key);
    else this.statusKeysByTask.set(task, observable.set<string>([key]));
  }

  /** Display status for one conversation: run status, plus its detached jobs. */
  private displayStatus(key: string): AgentDisplayStatus {
    return deriveAgentDisplayStatus(
      this.statuses.get(key) ?? 'idle',
      this.backgroundCounts.get(key) ?? 0
    );
  }

  /** Still-running detached jobs for one conversation. */
  sessionBackgroundJobCount(projectId: string, taskId: string, conversationId: string): number {
    return this.backgroundCounts.get(`${taskKey(projectId, taskId)}\0${conversationId}`) ?? 0;
  }

  /** Still-running detached jobs across every session of one task. */
  taskBackgroundJobCount(projectId: string, taskId: string): number {
    const task = taskKey(projectId, taskId);
    let total = 0;
    for (const key of this.statusKeysByTask.get(task) ?? []) {
      total += this.backgroundCounts.get(key) ?? 0;
    }
    return total;
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
  taskStatus(projectId: string, taskId: string): AgentDisplayStatus | null {
    const task = taskKey(projectId, taskId);
    let hasWorking = false;
    let hasAwaiting = false;
    let hasError = false;
    let hasCompleted = false;
    let hasBackground = false;
    for (const key of this.statusKeysByTask.get(task) ?? []) {
      const status = this.displayStatus(key);
      if (status === 'working') hasWorking = true;
      else if (status === 'awaiting-input') hasAwaiting = true;
      else if (status === 'error') hasError = true;
      else if (status === 'completed') hasCompleted = true;
      else if (status === 'background') hasBackground = true;
    }
    if (hasAwaiting) return 'awaiting-input';
    if (hasWorking) return 'working';
    // Ranked directly below `working`: still in-flight work, but nothing the
    // user has to act on, so it yields to a session asking for attention.
    if (hasBackground) return 'background';
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
      const status = this.displayStatus(key);
      if (status === 'idle') continue;
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
  ): Exclude<AgentDisplayStatus, 'idle'> | null {
    const task = taskKey(projectId, taskId);
    const status = this.displayStatus(`${task}\0${conversationId}`);
    if (status === 'idle') return null;
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

  /**
   * Whether the agent itself is mid-turn. `background` is deliberately not
   * "running": the turn is over and only a detached job is left, which nothing
   * can be interrupted or waited on through the session.
   */
  isTaskRunning(projectId: string, taskId: string): boolean {
    const status = this.taskStatus(projectId, taskId);
    return status !== null && status !== 'background' && isAgentSessionRunningStatus(status);
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
