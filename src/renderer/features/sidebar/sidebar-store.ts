import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { type LocalProject, type SshProject } from '@shared/projects';
import type { SidebarSnapshot, SidebarTaskGroupBy, SidebarTaskSortBy } from '@shared/view-state';
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

function parseSidebarTaskGroupBy(value: unknown): SidebarTaskGroupBy | undefined {
  return value === 'project' || value === 'none' || value === 'type' || value === 'activity'
    ? value
    : undefined;
}

export type ActivityBucket = 'today' | 'thisWeek' | 'thisMonth' | 'earlier';

function activityBucketFor(instant: string, now: Date = new Date()): ActivityBucket {
  if (!instant) return 'earlier';
  const ts = Date.parse(instant);
  if (Number.isNaN(ts)) return 'earlier';
  const then = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday) return 'today';
  // Week starts Monday (locale-agnostic, consistent with Yoda task list grouping).
  const day = now.getDay(); // 0 = Sun
  const daysSinceMonday = (day + 6) % 7;
  const startOfWeek = startOfToday - daysSinceMonday * 86400_000;
  if (then.getTime() >= startOfWeek) return 'thisWeek';
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (then.getTime() >= startOfMonth) return 'thisMonth';
  return 'earlier';
}

const ACTIVITY_ORDER: ActivityBucket[] = ['today', 'thisWeek', 'thisMonth', 'earlier'];

export function getSortInstant(task: TaskStore, kind: 'created' | 'updated'): string {
  const reg = registeredTaskData(task);
  if (reg) {
    if (kind === 'created') return reg.createdAt;
    return reg.lastInteractedAt ?? '';
  }
  const u = unregisteredTaskData(task);
  if (u) {
    if (kind === 'created') return u.createdAt;
    return u.lastInteractedAt;
  }
  return '';
}

export type SidebarGroupKey =
  | { kind: 'type'; type: 'local' | 'ssh' }
  | { kind: 'activity'; bucket: ActivityBucket };

export type SidebarRow =
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string; showProjectTag?: boolean }
  | { kind: 'group'; group: SidebarGroupKey };

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
  taskGroupBy: SidebarTaskGroupBy = 'project';
  pinnedCollapsed = false;
  projectsCollapsed = false;
  projectTypeFilter: ProjectTypeFilter = 'all';
  hideProjectsWithoutActiveTasks = false;

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

    const taskFiltered = this.hideProjectsWithoutActiveTasks
      ? typeFiltered.filter((p) => this.shouldShowProjectByTaskPresence(p))
      : typeFiltered;

    const sorted = this.sortProjectsForSidebar(taskFiltered);

    return [...unregistered, ...sorted];
  }

  get sidebarRows(): SidebarRow[] {
    switch (this.taskGroupBy) {
      case 'none':
        return this.flatTaskRows();
      case 'type':
        return this.groupedByTypeRows();
      case 'activity':
        return this.groupedByActivityRows();
      case 'project':
      default:
        return this.projectGroupedRows();
    }
  }

  private projectGroupedRows(): SidebarRow[] {
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

  /** Flat list of all non-pinned, active tasks across all visible projects. */
  private flatTaskRows(): SidebarRow[] {
    const pairs = this.collectVisibleTaskPairs();
    pairs.sort((a, b) => this.compareSidebarTasks(a.task, b.task));
    return pairs.map(({ projectId, task }) => ({
      kind: 'task' as const,
      projectId,
      taskId: task.data.id,
      showProjectTag: true,
    }));
  }

  private groupedByTypeRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    const sectionOrder: ('local' | 'ssh')[] = ['local', 'ssh'];
    for (const sectionType of sectionOrder) {
      const sectionProjects = this.orderedProjects.filter((p) => {
        if (p.state === 'unregistered') return sectionType === 'local';
        return p.data!.type === sectionType;
      });
      if (sectionProjects.length === 0) continue;
      rows.push({ kind: 'group', group: { kind: 'type', type: sectionType } });
      for (const project of sectionProjects) {
        const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
        if (project.state !== 'unregistered' && this.isProjectPinned(projectId)) continue;
        rows.push({ kind: 'project', projectId });
        if (this.expandedProjectIds.has(projectId) && project.mountedProject) {
          const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter(
            isActiveSidebarTask
          );
          const ordered = this.sortTasksForSidebar(tasks);
          for (const task of ordered) {
            if (task.data.isPinned) continue;
            rows.push({ kind: 'task', projectId, taskId: task.data.id });
          }
        }
      }
    }
    return rows;
  }

  private groupedByActivityRows(): SidebarRow[] {
    const pairs = this.collectVisibleTaskPairs();
    const now = new Date();
    const buckets = new Map<ActivityBucket, { projectId: string; task: TaskStore }[]>();
    for (const pair of pairs) {
      const kind: 'created' | 'updated' = this.taskSortBy === 'created-at' ? 'created' : 'updated';
      const bucket = activityBucketFor(getSortInstant(pair.task, kind), now);
      const arr = buckets.get(bucket) ?? [];
      arr.push(pair);
      buckets.set(bucket, arr);
    }
    const rows: SidebarRow[] = [];
    for (const bucket of ACTIVITY_ORDER) {
      const arr = buckets.get(bucket);
      if (!arr || arr.length === 0) continue;
      arr.sort((a, b) => this.compareSidebarTasks(a.task, b.task));
      rows.push({ kind: 'group', group: { kind: 'activity', bucket } });
      for (const { projectId, task } of arr) {
        rows.push({
          kind: 'task',
          projectId,
          taskId: task.data.id,
          showProjectTag: true,
        });
      }
    }
    return rows;
  }

  private collectVisibleTaskPairs(): { projectId: string; task: TaskStore }[] {
    const pinnedProjectIds = new Set(this.pinnedProjectIds);
    const pairs: { projectId: string; task: TaskStore }[] = [];
    for (const project of this.orderedProjects) {
      if (!project.mountedProject) continue;
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      if (project.state !== 'unregistered' && pinnedProjectIds.has(projectId)) continue;
      for (const task of project.mountedProject.taskManager.tasks.values()) {
        if (!isActiveSidebarTask(task)) continue;
        if (task.data.isPinned) continue;
        pairs.push({ projectId, task });
      }
    }
    return pairs;
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
      taskGroupBy: this.taskGroupBy,
      pinnedProjectIds: this.validPinnedProjectIds(),
      pinnedCollapsed: this.pinnedCollapsed,
      projectsCollapsed: this.projectsCollapsed,
      hideProjectsWithoutActiveTasks: this.hideProjectsWithoutActiveTasks,
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
    if (snapshot.taskGroupBy !== undefined) {
      const v = parseSidebarTaskGroupBy(snapshot.taskGroupBy);
      if (v !== undefined) this.taskGroupBy = v;
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
    if (snapshot.hideProjectsWithoutActiveTasks !== undefined) {
      this.hideProjectsWithoutActiveTasks = snapshot.hideProjectsWithoutActiveTasks === true;
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

  setHideProjectsWithoutActiveTasks(hidden: boolean): void {
    this.hideProjectsWithoutActiveTasks = hidden;
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

  /** Switching grouping mode also clears manual task order — it no longer applies. */
  applyGroupBy(groupBy: SidebarTaskGroupBy): void {
    if (this.taskGroupBy === groupBy) return;
    this.taskGroupBy = groupBy;
    if (groupBy !== 'project') {
      this.taskOrderByProject = {};
    }
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
    if (this.taskSortBy === 'updated-at') {
      // When sorting by recent activity, project order follows the latest
      // submitted user prompt in each project. Manual DnD order is ignored in
      // this mode — picking "Last used" implies recency should drive layout.
      return [...projects].sort((a, b) => {
        const ra = this.mostRecentTaskInstant(a);
        const rb = this.mostRecentTaskInstant(b);
        const d = rb.localeCompare(ra);
        if (d !== 0) return d;
        return a.data.id.localeCompare(b.data.id);
      });
    }
    return [...projects].sort((a, b) => {
      const ai = this.projectOrder.indexOf(a.data.id);
      const bi = this.projectOrder.indexOf(b.data.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  private mostRecentTaskInstant(project: RegisteredProjectStore): string {
    if (!project.mountedProject) return '';
    let best = '';
    for (const task of project.mountedProject.taskManager.tasks.values()) {
      if (!isActiveSidebarTask(task)) continue;
      const instant = getSortInstant(task, 'updated');
      if (instant && instant > best) best = instant;
    }
    return best;
  }

  private shouldShowProjectByTaskPresence(project: ProjectStore): boolean {
    if (!project.mountedProject) return true;
    return Array.from(project.mountedProject.taskManager.tasks.values()).some(isActiveSidebarTask);
  }

  private validPinnedProjectIds(): string[] {
    return [...this.pinnedProjectIds].filter((id) => {
      const project = this.projectManager.projects.get(id);
      return project !== undefined && project.state !== 'unregistered';
    });
  }
}
