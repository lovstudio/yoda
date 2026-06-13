import { makeAutoObservable } from 'mobx';

export interface SplitPaneRef {
  projectId: string;
  taskId: string;
}

/**
 * Extra task panes tiled beside the primary (routed) task in the main content
 * area. The primary pane is always the currently routed task — these are the
 * additional tasks shown alongside it for side-by-side comparison.
 *
 * Module singleton (not persisted for now): the tiling is an ephemeral
 * comparison workspace, cleared when the user is done. The routed task is never
 * stored here; the grid renders [routed primary, ...these] and de-dupes the
 * primary out of the extras.
 */
class SplitViewStore {
  panes: SplitPaneRef[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  get count(): number {
    return this.panes.length;
  }

  has(taskId: string): boolean {
    return this.panes.some((pane) => pane.taskId === taskId);
  }

  add(ref: SplitPaneRef): void {
    if (this.has(ref.taskId)) return;
    this.panes.push(ref);
  }

  addMany(refs: SplitPaneRef[]): void {
    for (const ref of refs) this.add(ref);
  }

  /** Replace the whole set in one shot (used by "tile all candidates"). */
  replace(refs: SplitPaneRef[]): void {
    const seen = new Set<string>();
    this.panes = refs.filter((ref) => {
      if (seen.has(ref.taskId)) return false;
      seen.add(ref.taskId);
      return true;
    });
  }

  remove(taskId: string): void {
    this.panes = this.panes.filter((pane) => pane.taskId !== taskId);
  }

  clear(): void {
    this.panes = [];
  }
}

export const splitViewStore = new SplitViewStore();
