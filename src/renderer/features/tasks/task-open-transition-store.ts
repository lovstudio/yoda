import { action, makeObservable, observable } from 'mobx';
import type { TaskWindowTabTarget } from '@shared/task-window';

function taskOpenKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

/**
 * Bridges the short gap between task provisioning and committing its final
 * internal target. A provisioned store becomes observable before the async
 * opener continuation runs; without this lease the ready layout can paint its
 * overview, conversation-list, and terminal empty states for one frame.
 */
class TaskOpenTransitionStore {
  private readonly pendingByTask = observable.map<string, symbol>();
  private readonly failedByTask = observable.map<string, symbol>();
  private readonly targetByTask = observable.map<string, TaskWindowTabTarget>();
  private readonly errorByTask = observable.map<string, string>();
  private readonly sessionOpeningOwnersByTask = observable.map<string, Set<symbol>>();
  private readonly sessionErrorOwnersByTask = observable.map<string, Set<symbol>>();

  constructor() {
    makeObservable<
      this,
      | 'pendingByTask'
      | 'failedByTask'
      | 'targetByTask'
      | 'errorByTask'
      | 'sessionOpeningOwnersByTask'
      | 'sessionErrorOwnersByTask'
    >(this, {
      pendingByTask: observable,
      failedByTask: observable,
      targetByTask: observable,
      errorByTask: observable,
      sessionOpeningOwnersByTask: observable,
      sessionErrorOwnersByTask: observable,
      begin: action,
      complete: action,
      fail: action,
      dismissFailure: action,
      reportSessionOpening: action,
      clearSessionOpening: action,
      reportSessionError: action,
      clearSessionError: action,
    });
  }

  begin(projectId: string, taskId: string): symbol {
    const key = taskOpenKey(projectId, taskId);
    const lease = Symbol(taskOpenKey(projectId, taskId));
    this.failedByTask.delete(key);
    this.targetByTask.delete(key);
    this.errorByTask.delete(key);
    this.pendingByTask.set(key, lease);
    return lease;
  }

  complete(projectId: string, taskId: string, lease: symbol): void {
    const key = taskOpenKey(projectId, taskId);
    if (this.pendingByTask.get(key) !== lease) return;
    this.pendingByTask.delete(key);
    this.failedByTask.delete(key);
    this.targetByTask.delete(key);
    this.errorByTask.delete(key);
  }

  fail(
    projectId: string,
    taskId: string,
    lease: symbol,
    target: TaskWindowTabTarget,
    error?: unknown
  ): void {
    const key = taskOpenKey(projectId, taskId);
    if (this.pendingByTask.get(key) !== lease) return;
    this.failedByTask.set(key, lease);
    this.targetByTask.set(key, target);
    if (error !== undefined) {
      this.errorByTask.set(
        key,
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
    }
  }

  dismissFailure(projectId: string, taskId: string): void {
    const key = taskOpenKey(projectId, taskId);
    const failedLease = this.failedByTask.get(key);
    if (!failedLease || this.pendingByTask.get(key) !== failedLease) return;
    this.failedByTask.delete(key);
    this.targetByTask.delete(key);
    this.errorByTask.delete(key);
    this.pendingByTask.delete(key);
  }

  isPending(projectId: string, taskId: string): boolean {
    return this.pendingByTask.has(taskOpenKey(projectId, taskId));
  }

  /**
   * Keep the ordinary session-opening surface at TaskMainPanel, the nearest
   * common ancestor of the terminal and its history dock. A mounted
   * ConversationsPanel reports only readiness intent through an owner token;
   * it never paints a second loader in its own, smaller coordinate space.
   */
  reportSessionOpening(projectId: string, taskId: string, owner: symbol, isOpening: boolean): void {
    const key = taskOpenKey(projectId, taskId);
    const existingOwners = this.sessionOpeningOwnersByTask.get(key);
    if (!isOpening) {
      if (!existingOwners) return;
      existingOwners.delete(owner);
      if (existingOwners.size === 0) this.sessionOpeningOwnersByTask.delete(key);
      return;
    }

    if (existingOwners) {
      existingOwners.add(owner);
      return;
    }
    this.sessionOpeningOwnersByTask.set(key, observable.set([owner]));
  }

  clearSessionOpening(projectId: string, taskId: string, owner: symbol): void {
    this.reportSessionOpening(projectId, taskId, owner, false);
  }

  isSessionOpening(projectId: string, taskId: string): boolean {
    return (this.sessionOpeningOwnersByTask.get(taskOpenKey(projectId, taskId))?.size ?? 0) > 0;
  }

  reportSessionError(projectId: string, taskId: string, owner: symbol, hasError: boolean): void {
    const key = taskOpenKey(projectId, taskId);
    const existingOwners = this.sessionErrorOwnersByTask.get(key);
    if (!hasError) {
      if (!existingOwners) return;
      existingOwners.delete(owner);
      if (existingOwners.size === 0) this.sessionErrorOwnersByTask.delete(key);
      return;
    }

    if (existingOwners) {
      existingOwners.add(owner);
      return;
    }
    this.sessionErrorOwnersByTask.set(key, observable.set([owner]));
  }

  clearSessionError(projectId: string, taskId: string, owner: symbol): void {
    this.reportSessionError(projectId, taskId, owner, false);
  }

  hasSessionError(projectId: string, taskId: string): boolean {
    return (this.sessionErrorOwnersByTask.get(taskOpenKey(projectId, taskId))?.size ?? 0) > 0;
  }

  hasFailed(projectId: string, taskId: string): boolean {
    const key = taskOpenKey(projectId, taskId);
    const failedLease = this.failedByTask.get(key);
    return failedLease !== undefined && failedLease === this.pendingByTask.get(key);
  }

  failedTarget(projectId: string, taskId: string): TaskWindowTabTarget | null {
    if (!this.hasFailed(projectId, taskId)) return null;
    return this.targetByTask.get(taskOpenKey(projectId, taskId)) ?? null;
  }

  failureDebugInfo(projectId: string, taskId: string): string | null {
    if (!this.hasFailed(projectId, taskId)) return null;
    const key = taskOpenKey(projectId, taskId);
    const target = this.targetByTask.get(key);
    return [
      'Yoda — task session staging failed',
      `time: ${new Date().toISOString()}`,
      `project: ${projectId}`,
      `task: ${taskId}`,
      `target: ${target ? JSON.stringify(target) : 'n/a'}`,
      `error: ${this.errorByTask.get(key) ?? 'canonical frame unavailable'}`,
    ].join('\n');
  }
}

export const taskOpenTransitionStore = new TaskOpenTransitionStore();
