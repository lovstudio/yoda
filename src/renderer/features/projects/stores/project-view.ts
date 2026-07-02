import { makeAutoObservable } from 'mobx';
import type { ProjectViewSnapshot } from '@shared/view-state';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';

export type ProjectView =
  | 'overview'
  | 'tasks'
  | 'pullRequests'
  | 'sessions'
  | 'harness'
  | 'docs'
  | 'settings';

export class ProjectViewStore implements Snapshottable<ProjectViewSnapshot> {
  activeView: ProjectView = 'overview';
  taskView: TaskViewStore = new TaskViewStore();

  constructor() {
    makeAutoObservable(this);
  }

  setProjectView(view: ProjectView) {
    this.activeView = view;
  }

  get snapshot(): ProjectViewSnapshot {
    return {
      activeView: this.activeView,
      taskViewTab: this.taskView.tab,
      taskViewArchivedOnlyWithNote: this.taskView.archivedOnlyWithNote,
    };
  }

  restoreSnapshot(snapshot: Partial<ProjectViewSnapshot>): void {
    // Intentionally ignore snapshot.activeView — always land on Overview on
    // session start. Users navigate to other tabs via clicks; that state is
    // intra-session only.
    if (snapshot.taskViewTab) this.taskView.setTab(snapshot.taskViewTab);
    if (typeof snapshot.taskViewArchivedOnlyWithNote === 'boolean') {
      this.taskView.setArchivedOnlyWithNote(snapshot.taskViewArchivedOnlyWithNote);
    }
  }
}

class TaskViewStore {
  tab: 'active' | 'archived' = 'active';
  searchQuery: string = '';
  selectedIds: Set<string> = new Set();
  archivedOnlyWithNote: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  setTab(tab: 'active' | 'archived') {
    this.tab = tab;
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
  }

  setSelectedIds(ids: Set<string>) {
    this.selectedIds = ids;
  }

  setArchivedOnlyWithNote(value: boolean) {
    this.archivedOnlyWithNote = value;
  }

  toggleSelect(id: string) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
  }
}
