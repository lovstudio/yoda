import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { type LocalProject, type SshProject } from '@shared/projects';
import type { SidebarSnapshot, SidebarTaskSortBy } from '@shared/view-state';
import {
  type ProjectStore,
  type UnregisteredProject,
} from '@renderer/features/projects/stores/project';
import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import {
  registeredTaskData,
  unregisteredTaskData,
  type TaskStore,
} from '@renderer/features/tasks/stores/task';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';

function parseSidebarTaskSortBy(value: unknown): SidebarTaskSortBy | undefined {
  return value === 'created-at' || value === 'updated-at' ? value : undefined;
}

export function getSortInstant(task: TaskStore, kind: 'created' | 'updated'): string {
  const reg = registeredTaskData(task);
  if (reg) {
    if (kind === 'created') return reg.createdAt;
    return reg.lastInteractedAt ?? reg.updatedAt;
  }
  const u = unregisteredTaskData(task);
  if (u) {
    if (kind === 'created') return u.createdAt;
    return u.lastInteractedAt;
  }
  return '';
}

export type SidebarRow =
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string };

export type PinnedSidebarEntry =
  | { kind: 'project'; projectId: string }
  | { kind: 'project-task'; projectId: string; taskId: string }
  | { kind: 'task'; projectId: string; taskId: string };

export type ProjectTypeFilter = 'all' | 'local' | 'ssh';

function isActiveSidebarTask(task: TaskStore): boolean {
  return task.state === 'unregistered' || !('archivedAt' in task.data && task.data.archivedAt);
}

type RegisteredProjectStore = ProjectStore & { data: LocalProject | SshProject };

function isRegisteredProject(project: ProjectStore): project is RegisteredProjectStore {
  return project.state !== 'unregistered' && project.data !== null;
}

export class SidebarStore implements Snapshottable<SidebarSnapshot> {
  projectOrder: string[] = [];
  taskOrderByProject: Record<string, string[]> = {};
  expandedProjectIds = observable.set<string>();
  pinnedProjectIds = observable.set<string>();
  taskSortBy: SidebarTaskSortBy = 'created-at';
  pinnedCollapsed = false;
  projectsCollapsed = false;
  projectTypeFilter: ProjectTypeFilter = 'all';

  constructor(private readonly projectManager: ProjectManagerStore) {
    makeAutoObservable(this, {
      expandedProjectIds: false,
      pinnedProjectIds: false,
      sidebarRows: computed,
      pinnedSidebarEntries: computed,
    });

    // Auto-expand a project when its task count goes from 0 to >0.
    const prevTaskCounts = new Map<string, number>();
    reaction(
      () => {
        const counts: [string, number][] = [];
        for (const [id, project] of this.projectManager.projects) {
          if (project.mountedProject) {
            counts.push([id, project.mountedProject.taskManager.tasks.size]);
          }
        }
        return counts;
      },
      (counts) => {
        runInAction(() => {
          for (const [id, count] of counts) {
            const prev = prevTaskCounts.get(id) ?? 0;
            if (prev === 0 && count > 0) {
              this.ensureProjectExpanded(id);
            }
            prevTaskCounts.set(id, count);
          }
        });
      }
    );
  }

  get orderedProjects(): ProjectStore[] {
    const all = Array.from(this.projectManager.projects.values());

    const unregistered = all.filter((p): p is UnregisteredProject => p.state === 'unregistered');
    const real = all.filter(isRegisteredProject);

    const typeFiltered =
      this.projectTypeFilter === 'all'
        ? real
        : real.filter((p) => p.data.type === this.projectTypeFilter);

    const sorted = this.sortProjectsForSidebar(typeFiltered);

    return [...unregistered, ...sorted];
  }

  get sidebarRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const project of this.orderedProjects) {
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      if (project.state !== 'unregistered' && this.isProjectPinned(projectId)) continue;
      rows.push({ kind: 'project', projectId });
      if (this.expandedProjectIds.has(projectId) && project.mountedProject) {
        const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter(
          isActiveSidebarTask
        );
        const manualOrder = this.taskOrderByProject[projectId];
        const ordered = manualOrder?.length
          ? this.mergeTaskOrder(projectId, tasks)
          : this.sortTasksForSidebar(tasks);
        for (const task of ordered) {
          if (task.data.isPinned) continue;
          rows.push({ kind: 'task', projectId, taskId: task.data.id });
        }
      }
    }
    return rows;
  }

  /** Pinned projects plus pinned tasks that are not already under a pinned project. */
  get pinnedSidebarEntries(): PinnedSidebarEntry[] {
    const entries: PinnedSidebarEntry[] = [];
    const pinnedProjectIds = new Set(this.pinnedProjectIds);
    const pinnedProjects = this.sortProjectsForSidebar(
      Array.from(this.projectManager.projects.values()).filter(isRegisteredProject)
    ).filter((project) => pinnedProjectIds.has(project.data.id));

    for (const project of pinnedProjects) {
      const projectId = project.data.id;
      entries.push({ kind: 'project', projectId });
      if (!this.expandedProjectIds.has(projectId) || !project.mountedProject) continue;

      const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter(
        isActiveSidebarTask
      );
      const manualOrder = this.taskOrderByProject[projectId];
      const ordered = manualOrder?.length
        ? this.mergeTaskOrder(projectId, tasks)
        : this.sortTasksForSidebar(tasks);
      for (const task of ordered) {
        entries.push({ kind: 'project-task', projectId, taskId: task.data.id });
      }
    }

    const pairs: { projectId: string; task: TaskStore }[] = [];
    for (const project of this.projectManager.projects.values()) {
      if (!project.mountedProject) continue;
      const projectId = project.state === 'unregistered' ? project.id : project.data?.id;
      if (!projectId) continue;
      if (pinnedProjectIds.has(projectId) && this.expandedProjectIds.has(projectId)) continue;
      for (const task of project.mountedProject.taskManager.tasks.values()) {
        if (!isActiveSidebarTask(task) || !task.data.isPinned) continue;
        pairs.push({ projectId, task });
      }
    }
    pairs.sort((a, b) => this.compareSidebarTasks(a.task, b.task));
    return [
      ...entries,
      ...pairs.map(({ projectId, task }) => ({
        kind: 'task' as const,
        projectId,
        taskId: task.data.id,
      })),
    ];
  }

  get isEmpty(): boolean {
    return this.projectManager.projects.size === 0;
  }

  get snapshot(): SidebarSnapshot {
    return {
      expandedProjectIds: [...this.expandedProjectIds],
      projectOrder: [...this.projectOrder],
      taskOrderByProject: { ...this.taskOrderByProject },
      taskSortBy: this.taskSortBy,
      pinnedProjectIds: this.validPinnedProjectIds(),
      pinnedCollapsed: this.pinnedCollapsed,
      projectsCollapsed: this.projectsCollapsed,
    };
  }

  restoreSnapshot(snapshot: Partial<SidebarSnapshot>): void {
    if (snapshot.expandedProjectIds !== undefined) {
      this.expandedProjectIds.replace(snapshot.expandedProjectIds);
    }
    if (snapshot.projectOrder !== undefined) {
      this.projectOrder = [...snapshot.projectOrder];
    }
    if (snapshot.taskOrderByProject !== undefined) {
      this.taskOrderByProject = { ...snapshot.taskOrderByProject };
    }
    if (snapshot.taskSortBy !== undefined) {
      const v = parseSidebarTaskSortBy(snapshot.taskSortBy);
      if (v !== undefined) this.taskSortBy = v;
    }
    if (snapshot.pinnedProjectIds !== undefined) {
      this.pinnedProjectIds.replace(snapshot.pinnedProjectIds);
    }
    if (snapshot.pinnedCollapsed !== undefined) {
      this.pinnedCollapsed = snapshot.pinnedCollapsed;
    }
    if (snapshot.projectsCollapsed !== undefined) {
      this.projectsCollapsed = snapshot.projectsCollapsed;
    }
  }

  togglePinnedCollapsed(): void {
    this.pinnedCollapsed = !this.pinnedCollapsed;
  }

  toggleProjectsCollapsed(): void {
    this.projectsCollapsed = !this.projectsCollapsed;
  }

  /** Called on first load when no snapshot exists — expand all known projects. */
  expandAllProjects(): void {
    for (const project of this.orderedProjects) {
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      this.expandedProjectIds.add(projectId);
    }
  }

  collapseAllProjects(): void {
    this.expandedProjectIds.clear();
  }

  setProjectTypeFilter(filter: ProjectTypeFilter): void {
    this.projectTypeFilter = filter;
  }

  isProjectPinned(projectId: string): boolean {
    return this.pinnedProjectIds.has(projectId);
  }

  setProjectPinned(projectId: string, isPinned: boolean): void {
    if (!isPinned) {
      this.pinnedProjectIds.delete(projectId);
      return;
    }
    const project = this.projectManager.projects.get(projectId);
    if (!project || project.state === 'unregistered') return;
    this.pinnedProjectIds.add(projectId);
  }

  toggleProjectPinned(projectId: string): void {
    this.setProjectPinned(projectId, !this.isProjectPinned(projectId));
  }

  clearManualTaskOrder(): void {
    this.taskOrderByProject = {};
  }

  toggleProjectExpanded(projectId: string): void {
    if (this.expandedProjectIds.has(projectId)) {
      this.expandedProjectIds.delete(projectId);
    } else {
      this.expandedProjectIds.add(projectId);
    }
  }

  ensureProjectExpanded(projectId: string): void {
    this.expandedProjectIds.add(projectId);
  }

  setTaskSortBy(sortBy: SidebarTaskSortBy): void {
    this.taskSortBy = sortBy;
  }

  /** Set the sort key and clear all manual task orders so the list fully re-sorts. */
  applySort(sortBy: SidebarTaskSortBy): void {
    this.taskSortBy = sortBy;
    this.taskOrderByProject = {};
  }

  setProjectOrder(ids: string[]): void {
    this.projectOrder = ids;
  }

  prependProjectOrder(id: string): void {
    const filtered = this.projectOrder.filter((existing) => existing !== id);
    this.projectOrder = [id, ...filtered];
  }

  mergeTaskOrder(projectId: string, tasks: TaskStore[]): TaskStore[] {
    const stored = this.taskOrderByProject[projectId] ?? [];
    const byId = new Map(tasks.map((t) => [t.data.id, t] as const));
    const seen = new Set<string>();
    const result: TaskStore[] = [];
    for (const id of stored) {
      const t = byId.get(id);
      if (t) {
        result.push(t);
        seen.add(id);
      }
    }
    // New tasks (not in the manual order) are sorted by date and prepended so
    // they always appear at the top rather than buried after manually-ordered tasks.
    const newTasks = tasks
      .filter((t) => !seen.has(t.data.id))
      .sort((a, b) => this.compareSidebarTasks(a, b));
    return [...newTasks, ...result];
  }

  setTaskOrder(projectId: string, orderedIds: string[]): void {
    this.taskOrderByProject = { ...this.taskOrderByProject, [projectId]: orderedIds };
  }

  private compareSidebarTasks(a: TaskStore, b: TaskStore): number {
    const kind: 'created' | 'updated' = this.taskSortBy === 'created-at' ? 'created' : 'updated';
    const ia = getSortInstant(a, kind);
    const ib = getSortInstant(b, kind);
    const d = ib.localeCompare(ia);
    if (d !== 0) return d;
    return a.data.id.localeCompare(b.data.id);
  }

  private sortTasksForSidebar(tasks: TaskStore[]): TaskStore[] {
    return [...tasks].sort((a, b) => this.compareSidebarTasks(a, b));
  }

  private sortProjectsForSidebar(projects: RegisteredProjectStore[]): RegisteredProjectStore[] {
    return [...projects].sort((a, b) => {
      const ai = this.projectOrder.indexOf(a.data.id);
      const bi = this.projectOrder.indexOf(b.data.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  private validPinnedProjectIds(): string[] {
    return [...this.pinnedProjectIds].filter((id) => {
      const project = this.projectManager.projects.get(id);
      return project !== undefined && project.state !== 'unregistered';
    });
  }
}
