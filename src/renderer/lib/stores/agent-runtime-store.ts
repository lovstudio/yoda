import { makeAutoObservable, observable, runInAction } from 'mobx';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { events } from '@renderer/lib/ipc';

export type AgentRuntimeSnapshot = {
  /** Task ids the user has opened since their status last became attention-worthy. */
  seenTaskIds?: string[];
};

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\0${taskId}`;
}

/** Statuses that mean "the agent wants the user's attention" (unread candidates). */
function isAttentionStatus(status: AgentSessionRuntimeStatus): boolean {
  return status === 'awaiting-input' || status === 'completed' || status === 'error';
}

/**
 * Global, mount-independent mirror of the main-process agent run-state store.
 *
 * The per-task `ConversationManagerStore` hydrates persisted status only when a
 * task is mounted. This store mirrors those task-scoped results and keeps them
 * live via {@link agentSessionStatusChangedChannel}. Avoiding a global cold-load
 * keeps startup cost proportional to the task the user actually opens.
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

  dispose(): void {
    this.off?.();
    this.off = null;
  }

  private applyStatus(
    projectId: string,
    taskId: string,
    conversationId: string,
    status: AgentSessionRuntimeStatus
  ): void {
    runInAction(() => {
      this.statuses.set(`${taskKey(projectId, taskId)}\0${conversationId}`, status);
      // A task re-entering an attention status is "unread" again until reopened.
      if (isAttentionStatus(status)) this.seenTaskIds.delete(taskKey(projectId, taskId));
    });
  }

  /** Aggregate status for a task, mirroring `ConversationManagerStore.taskStatus`. */
  taskStatus(projectId: string, taskId: string): AgentSessionRuntimeStatus | null {
    const prefix = `${taskKey(projectId, taskId)}\0`;
    let hasWorking = false;
    let hasAwaiting = false;
    let hasError = false;
    let hasCompleted = false;
    for (const [key, status] of this.statuses) {
      if (!key.startsWith(prefix)) continue;
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
   * Task status for the sidebar indicator, in display priority: awaiting-input
   * → unread error/completed (needs the user's verdict, even while another
   * session still works) → working. Differs from {@link taskStatus}, which
   * ranks working above finished states for run-state semantics.
   */
  taskDisplayStatus(projectId: string, taskId: string): AgentSessionRuntimeStatus | null {
    const prefix = `${taskKey(projectId, taskId)}\0`;
    let hasWorking = false;
    let hasError = false;
    let hasCompleted = false;
    for (const [key, status] of this.statuses) {
      if (!key.startsWith(prefix)) continue;
      if (status === 'awaiting-input') return 'awaiting-input';
      if (status === 'working') hasWorking = true;
      else if (status === 'error') hasError = true;
      else if (status === 'completed') hasCompleted = true;
    }
    const unread = !this.seenTaskIds.has(taskKey(projectId, taskId));
    if (unread && hasError) return 'error';
    if (unread && hasCompleted) return 'completed';
    if (hasWorking) return 'working';
    return null;
  }

  /**
   * Conversation ids of this task that want the user's attention, ordered
   * awaiting-input first, then error/completed. Drives the sidebar's
   * "jump to next pending session" affordance for tasks that aren't mounted
   * (mounted tasks use the finer-grained per-conversation `seen` flags).
   */
  attentionConversationIds(projectId: string, taskId: string): string[] {
    const prefix = `${taskKey(projectId, taskId)}\0`;
    const awaiting: string[] = [];
    const finished: string[] = [];
    for (const [key, status] of this.statuses) {
      if (!key.startsWith(prefix)) continue;
      if (status === 'awaiting-input') awaiting.push(key.slice(prefix.length));
      else if (status === 'error' || status === 'completed')
        finished.push(key.slice(prefix.length));
    }
    return [...awaiting, ...finished];
  }

  /** Conversation ids of this task whose sessions are currently `working`. */
  workingConversationIds(projectId: string, taskId: string): string[] {
    const prefix = `${taskKey(projectId, taskId)}\0`;
    const ids: string[] = [];
    for (const [key, status] of this.statuses) {
      if (status === 'working' && key.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
    return ids;
  }

  isTaskRunning(projectId: string, taskId: string): boolean {
    const status = this.taskStatus(projectId, taskId);
    return status !== null && isAgentSessionRunningStatus(status);
  }

  /** A task is unread when it has an attention-worthy status and hasn't been opened. */
  isTaskUnread(projectId: string, taskId: string): boolean {
    const status = this.taskStatus(projectId, taskId);
    if (!status || !isAttentionStatus(status)) return false;
    return !this.seenTaskIds.has(taskKey(projectId, taskId));
  }

  markTaskSeen(projectId: string, taskId: string): void {
    runInAction(() => this.seenTaskIds.add(taskKey(projectId, taskId)));
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
