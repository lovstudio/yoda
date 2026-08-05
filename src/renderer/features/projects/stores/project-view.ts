import { makeAutoObservable } from 'mobx';
import type { ProjectViewSnapshot } from '@shared/view-state';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';

export type ProjectView =
  | 'overview'
  | 'features'
  | 'tasks'
  | 'issues'
  | 'pullRequests'
  | 'sessions'
  | 'harness'
  | 'prompts'
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
    // `active` was the pre-category tab name. Keep existing local snapshots
    // usable after moving to the four mutually exclusive task categories.
    const savedTaskTab = snapshot.taskViewTab as string | undefined;
    if (savedTaskTab === 'active') {
      this.taskView.setTab('standard');
    } else if (
      savedTaskTab === 'standard' ||
      savedTaskTab === 'long-term' ||
      savedTaskTab === 'pending-acceptance' ||
      savedTaskTab === 'archived'
    ) {
      this.taskView.setTab(savedTaskTab);
    }
    if (typeof snapshot.taskViewArchivedOnlyWithNote === 'boolean') {
      this.taskView.setArchivedOnlyWithNote(snapshot.taskViewArchivedOnlyWithNote);
    }
  }
}

class TaskViewStore {
  tab: 'standard' | 'long-term' | 'pending-acceptance' | 'archived' = 'standard';
  searchQuery: string = '';
  selectedIds: Set<string> = new Set();
  archivedOnlyWithNote: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  setTab(tab: 'standard' | 'long-term' | 'pending-acceptance' | 'archived') {
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
