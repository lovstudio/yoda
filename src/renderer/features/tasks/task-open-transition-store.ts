import { action, makeObservable, observable } from 'mobx';

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

  constructor() {
    makeObservable<this, 'pendingByTask'>(this, {
      pendingByTask: observable,
      begin: action,
      complete: action,
    });
  }

  begin(projectId: string, taskId: string): symbol {
    const lease = Symbol(taskOpenKey(projectId, taskId));
    this.pendingByTask.set(taskOpenKey(projectId, taskId), lease);
    return lease;
  }

  complete(projectId: string, taskId: string, lease: symbol): void {
    const key = taskOpenKey(projectId, taskId);
    if (this.pendingByTask.get(key) === lease) this.pendingByTask.delete(key);
  }

  isPending(projectId: string, taskId: string): boolean {
    return this.pendingByTask.has(taskOpenKey(projectId, taskId));
  }
}

export const taskOpenTransitionStore = new TaskOpenTransitionStore();
