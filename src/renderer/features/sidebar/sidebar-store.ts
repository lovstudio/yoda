import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { type LocalProject, type SshProject } from '@shared/projects';
import type {
  SidebarBranchDisplay,
  SidebarSnapshot,
  SidebarTaskGroupBy,
  SidebarTaskSortBy,
} from '@shared/view-state';
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
import type { WorkspaceStore } from '@renderer/features/workspaces/workspace-store';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';

function parseSidebarTaskSortBy(value: unknown): SidebarTaskSortBy | undefined {
  return value === 'created-at' || value === 'updated-at' ? value : undefined;
}

function parseSidebarTaskGroupBy(value: unknown): SidebarTaskGroupBy | undefined {
  return value === 'project' || value === 'none' || value === 'type' || value === 'activity'
    ? value
    : undefined;
}

function parseSidebarBranchDisplay(value: unknown): SidebarBranchDisplay | undefined {
  return value === 'hidden' || value === 'compact' || value === 'full' ? value : undefined;
}

export type ActivityBucket = 'today' | 'thisWeek' | 'thisMonth' | 'earlier';

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function parseSidebarInstant(instant: string): number {
  if (!instant) return Number.NEGATIVE_INFINITY;
  const normalized = SQLITE_TIMESTAMP_RE.test(instant) ? `${instant.replace(' ', 'T')}Z` : instant;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

export function compareSidebarInstantsDesc(a: string, b: string): number {
  const at = parseSidebarInstant(a);
  const bt = parseSidebarInstant(b);
  if (at !== bt) return bt - at;
  return b.localeCompare(a);
}

function activityBucketFor(instant: string, now: Date = new Date()): ActivityBucket {
  if (!instant) return 'earlier';
  const ts = parseSidebarInstant(instant);
  if (!Number.isFinite(ts)) return 'earlier';
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
    return reg.lastInteractedAt ?? reg.createdAt;
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
  | {
      kind: 'task';
      projectId: string;
      taskId: string;
      showProjectTag?: boolean;
      /** Subtask tree depth (0 = root). Only set in project grouping mode. */
      depth?: number;
      /** Direct visible children count; > 0 renders the collapse chevron. */
      childCount?: number;
      /**
       * Terminal-tree guide info, one entry per indent slot (length === depth).
       * Slots before the last draw a full vertical line when true (that
       * ancestor has more siblings below). The last slot draws the elbow; true
       * means the line continues below (├), false means it ends here (└).
       */
      treeTrail?: boolean[];
    }
  | { kind: 'group'; group: SidebarGroupKey };

export type PinnedSidebarEntry =
  | { kind: 'project'; projectId: string }
  | { kind: 'project-task'; projectId: string; taskId: string }
  | { kind: 'task'; projectId: string; taskId: string };

export type ProjectTypeFilter = 'all' | 'local' | 'ssh';

function isActiveSidebarTask(task: TaskStore): boolean {
  return task.state === 'unregistered' || !('archivedAt' in task.data && task.data.archivedAt);
}

/** Archive in flight: requested but not yet completed (the row still shows while the saga runs). */
function taskIsArchiving(task: TaskStore): boolean {
  const reg = registeredTaskData(task);
  return !!reg?.archiveRequestedAt && !reg.archivedAt;
}

type RegisteredProjectStore = ProjectStore & { data: LocalProject | SshProject };

function isRegisteredProject(project: ProjectStore): project is RegisteredProjectStore {
  return project.state !== 'unregistered' && project.data !== null;
}

export class SidebarStore implements Snapshottable<SidebarSnapshot> {
  projectOrder: string[] = [];
  taskOrderByProject: Record<string, string[]> = {};
  /** Manual order of subtasks per parent task id; root tasks use taskOrderByProject. */
  taskOrderByParent: Record<string, string[]> = {};
  /** Tasks whose subtask subtree is collapsed (default expanded). */
  collapsedTaskIds = observable.set<string>();
  /**
   * Monotonic per-project "last activity" stamp used to order projects in
   * `updated-at` mode. It only ever moves forward: a new task or a newer task
   * interaction bumps it, but archiving the most-recent task does NOT pull it
   * back (an archived task no longer appears in the list, so it should not drag
   * its project's position around).
   */
  projectActivityById: Record<string, string> = {};
  expandedProjectIds = observable.set<string>();
  pinnedProjectIds = observable.set<string>();
  taskSortBy: SidebarTaskSortBy = 'updated-at';
  taskGroupBy: SidebarTaskGroupBy = 'project';
  taskBranchDisplay: SidebarBranchDisplay = 'compact';
  pinnedCollapsed = false;
  projectsCollapsed = false;
  projectTypeFilter: ProjectTypeFilter = 'all';
  hideProjectsWithoutActiveTasks = false;
  /** Sort tasks marked "稍后再读" (needsReview) to the bottom of their group. */
  sortNeedsReviewLast = false;
  /** Sort tasks with an archive in flight to the bottom of their group. */
  sortArchivingLast = false;
  /**
   * Deferred reflow: while the pointer is inside a task list, the needsReview
   * values used for demotion are frozen at this snapshot so rows don't jump
   * under the cursor when marked. Released (null) when the pointer leaves —
   * the list then reflows. Archive demotion stays live on purpose: archiving
   * means "get it out of the way", so it sinks immediately.
   */
  private frozenNeedsReviewByTaskId: ReadonlyMap<string, boolean> | null = null;
  /** Active reflow-hold sources (pointer-in-list, open row menu, …). */
  private readonly reflowHoldReasons = new Set<string>();
  /** Global show/hide for the entire secondary nav section. */
  navSectionHidden = false;

  constructor(
    private readonly projectManager: ProjectManagerStore,
    private readonly workspaceStore: WorkspaceStore
  ) {
    makeAutoObservable(this, {
      expandedProjectIds: false,
      pinnedProjectIds: false,
      collapsedTaskIds: false,
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

    // Track each project's most-recent active-task instant and fold it into the
    // monotonic `projectActivityById` stamp. Only forward moves are recorded, so
    // archiving the latest task never demotes the project in `updated-at` order.
    reaction(
      () => {
        const instants: [string, string][] = [];
        for (const project of this.projectManager.projects.values()) {
          if (!isRegisteredProject(project)) continue;
          instants.push([project.data.id, this.mostRecentTaskInstant(project)]);
        }
        return instants;
      },
      (instants) => {
        runInAction(() => {
          for (const [id, instant] of instants) {
            if (!instant) continue;
            const current = this.projectActivityById[id] ?? '';
            // compareSidebarInstantsDesc < 0 means `instant` is newer than `current`.
            if (compareSidebarInstantsDesc(instant, current) < 0) {
              this.projectActivityById[id] = instant;
            }
          }
        });
      },
      { fireImmediately: true }
    );
  }

  /**
   * Whether a project belongs to the active workspace selection. "All" matches
   * everything; "Default" matches projects with no workspace. Unregistered
   * projects (no DB row) use the workspace they will be assigned to on creation.
   */
  private matchesActiveWorkspace(project: ProjectStore): boolean {
    const workspaceId =
      project.state === 'unregistered'
        ? project.pendingWorkspaceId
        : (project.data?.workspaceId ?? null);
    return this.workspaceStore.matchesActive(workspaceId);
  }

  get orderedProjects(): ProjectStore[] {
    const all = Array.from(this.projectManager.projects.values());

    const unregistered = all
      .filter((p): p is UnregisteredProject => p.state === 'unregistered')
      .filter((p) => this.matchesActiveWorkspace(p));
    const real = all
      .filter(isRegisteredProject)
      .filter((p) => !p.data.isInternal)
      .filter((p) => this.matchesActiveWorkspace(p));

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
        rows.push(...this.buildTaskTreeRows(projectId, tasks));
      }
    }
    return rows;
  }

  /**
   * Flatten the project's tasks into depth-annotated rows (parents before
   * children, DFS order). Tasks whose parent is not visible in this list
   * (archived, pinned away, unknown) are promoted to root at display time —
   * the DB relationship is left untouched.
   */
  buildTaskTreeRows(projectId: string, tasks: TaskStore[]): SidebarRow[] {
    const visible = tasks.filter((task) => !task.data.isPinned);
    const visibleIds = new Set(visible.map((task) => task.data.id));

    const roots: TaskStore[] = [];
    const childrenByParent = new Map<string, TaskStore[]>();
    for (const task of visible) {
      const parentId = registeredTaskData(task)?.parentTaskId;
      if (parentId && visibleIds.has(parentId)) {
        const siblings = childrenByParent.get(parentId) ?? [];
        siblings.push(task);
        childrenByParent.set(parentId, siblings);
      } else {
        roots.push(task);
      }
    }

    const rows: SidebarRow[] = [];
    const visited = new Set<string>();
    // `hidden` subtrees (under a collapsed ancestor) still get visited so the
    // dirty-cycle fallback below doesn't resurface them at root.
    // `trail` carries the terminal-tree guide state (see SidebarRow.treeTrail).
    const emitSubtree = (
      task: TaskStore,
      depth: number,
      hidden: boolean,
      trail: boolean[]
    ): void => {
      const taskId = task.data.id;
      if (visited.has(taskId)) return; // dirty-data cycle guard
      visited.add(taskId);
      const children = childrenByParent.get(taskId) ?? [];
      if (!hidden) {
        rows.push({
          kind: 'task',
          projectId,
          taskId,
          depth,
          childCount: children.length,
          treeTrail: trail.length > 0 ? trail : undefined,
        });
      }
      const childHidden = hidden || this.collapsedTaskIds.has(taskId);
      const ordered = this.orderSiblings(projectId, taskId, children);
      ordered.forEach((child, index) => {
        emitSubtree(child, depth + 1, childHidden, [...trail, index < ordered.length - 1]);
      });
    };

    for (const root of this.orderSiblings(projectId, null, roots)) {
      emitSubtree(root, 0, false, []);
    }
    // Dirty-data cycles (A→B→A) have no root and would otherwise vanish —
    // surface any unvisited task at the root level instead of losing it.
    for (const task of visible) {
      if (!visited.has(task.data.id)) emitSubtree(task, 0, false, []);
    }
    return rows;
  }

  /**
   * Order a sibling group: root tasks use the per-project manual order, child
   * tasks the per-parent one; without a manual order fall back to date sort.
   */
  private orderSiblings(
    projectId: string,
    parentTaskId: string | null,
    siblings: TaskStore[]
  ): TaskStore[] {
    const stored =
      parentTaskId === null
        ? this.taskOrderByProject[projectId]
        : this.taskOrderByParent[parentTaskId];
    if (stored?.length) return this.mergeOrderedTasks(stored, siblings);
    return this.sortTasksForSidebar(siblings);
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
      const bucket = activityBucketFor(getSortInstant(pair.task, 'updated'), now);
      const arr = buckets.get(bucket) ?? [];
      arr.push(pair);
      buckets.set(bucket, arr);
    }
    const rows: SidebarRow[] = [];
    for (const bucket of ACTIVITY_ORDER) {
      const arr = buckets.get(bucket);
      if (!arr || arr.length === 0) continue;
      arr.sort((a, b) => this.compareSidebarTasksBy(a.task, b.task, 'updated'));
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
      Array.from(this.projectManager.projects.values())
        .filter(isRegisteredProject)
        .filter((p) => !p.data.isInternal)
        .filter((p) => this.matchesActiveWorkspace(p))
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
      // Tasks already rendered under their expanded pinned project entry.
      if (
        pinnedProjectIds.has(projectId) &&
        this.expandedProjectIds.has(projectId) &&
        this.matchesActiveWorkspace(project)
      ) {
        continue;
      }
      // Pinned tasks can be assigned to a workspace individually; without an
      // override they follow their project's workspace.
      const projectWorkspaceId =
        project.state === 'unregistered' ? null : (project.data?.workspaceId ?? null);
      for (const task of project.mountedProject.taskManager.tasks.values()) {
        if (!isActiveSidebarTask(task) || !task.data.isPinned) continue;
        const taskWorkspaceId =
          'sidebarWorkspaceId' in task.data ? task.data.sidebarWorkspaceId : undefined;
        if (!this.workspaceStore.matchesActive(taskWorkspaceId ?? projectWorkspaceId)) continue;
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
    for (const project of this.projectManager.projects.values()) {
      if (!isRegisteredProject(project)) return false;
      if (!project.data.isInternal) return false;
    }
    return true;
  }

  get snapshot(): SidebarSnapshot {
    return {
      expandedProjectIds: [...this.expandedProjectIds],
      projectOrder: [...this.projectOrder],
      taskOrderByProject: { ...this.taskOrderByProject },
      taskOrderByParent: { ...this.taskOrderByParent },
      collapsedTaskIds: [...this.collapsedTaskIds],
      projectActivityById: { ...this.projectActivityById },
      taskSortBy: this.taskSortBy,
      taskGroupBy: this.taskGroupBy,
      taskBranchDisplay: this.taskBranchDisplay,
      pinnedProjectIds: [...this.pinnedProjectIds],
      pinnedCollapsed: this.pinnedCollapsed,
      projectsCollapsed: this.projectsCollapsed,
      hideProjectsWithoutActiveTasks: this.hideProjectsWithoutActiveTasks,
      sortNeedsReviewLast: this.sortNeedsReviewLast,
      sortArchivingLast: this.sortArchivingLast,
      activeWorkspaceId: this.workspaceStore.activeWorkspaceId,
      navSectionHidden: this.navSectionHidden,
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
    if (snapshot.taskOrderByParent !== undefined) {
      this.taskOrderByParent = { ...snapshot.taskOrderByParent };
    }
    if (snapshot.collapsedTaskIds !== undefined) {
      this.collapsedTaskIds.replace(snapshot.collapsedTaskIds);
    }
    if (snapshot.projectActivityById !== undefined) {
      this.projectActivityById = { ...snapshot.projectActivityById };
    }
    if (snapshot.taskSortBy !== undefined) {
      const v = parseSidebarTaskSortBy(snapshot.taskSortBy);
      if (v !== undefined) this.taskSortBy = v;
    }
    if (snapshot.taskGroupBy !== undefined) {
      const v = parseSidebarTaskGroupBy(snapshot.taskGroupBy);
      if (v !== undefined) this.taskGroupBy = v;
    }
    if (snapshot.taskBranchDisplay !== undefined) {
      const v = parseSidebarBranchDisplay(snapshot.taskBranchDisplay);
      if (v !== undefined) this.taskBranchDisplay = v;
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
    if (snapshot.sortNeedsReviewLast !== undefined) {
      this.sortNeedsReviewLast = snapshot.sortNeedsReviewLast === true;
    }
    if (snapshot.sortArchivingLast !== undefined) {
      this.sortArchivingLast = snapshot.sortArchivingLast === true;
    }
    if (snapshot.activeWorkspaceId !== undefined) {
      this.workspaceStore.restoreActiveWorkspaceId(snapshot.activeWorkspaceId);
    }
    if (snapshot.navSectionHidden !== undefined) {
      this.navSectionHidden = snapshot.navSectionHidden === true;
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

  setSortNeedsReviewLast(enabled: boolean): void {
    this.sortNeedsReviewLast = enabled;
    if (!enabled) {
      this.reflowHoldReasons.clear();
      this.frozenNeedsReviewByTaskId = null;
    }
  }

  setSortArchivingLast(enabled: boolean): void {
    this.sortArchivingLast = enabled;
  }

  setTaskBranchDisplay(display: SidebarBranchDisplay): void {
    this.taskBranchDisplay = display;
  }

  setNavSectionHidden(hidden: boolean): void {
    this.navSectionHidden = hidden;
  }

  toggleNavSectionHidden(): void {
    this.navSectionHidden = !this.navSectionHidden;
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
    this.taskOrderByParent = {};
  }

  toggleTaskCollapsed(taskId: string): void {
    if (this.collapsedTaskIds.has(taskId)) {
      this.collapsedTaskIds.delete(taskId);
    } else {
      this.collapsedTaskIds.add(taskId);
    }
  }

  ensureTaskExpanded(taskId: string): void {
    this.collapsedTaskIds.delete(taskId);
  }

  setChildTaskOrder(parentTaskId: string, orderedIds: string[]): void {
    this.taskOrderByParent = { ...this.taskOrderByParent, [parentTaskId]: orderedIds };
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
    this.taskOrderByParent = {};
  }

  /** Switching grouping mode also clears manual task order — it no longer applies. */
  applyGroupBy(groupBy: SidebarTaskGroupBy): void {
    if (this.taskGroupBy === groupBy) return;
    this.taskGroupBy = groupBy;
    if (groupBy !== 'project') {
      this.taskOrderByProject = {};
      this.taskOrderByParent = {};
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
    return this.mergeOrderedTasks(this.taskOrderByProject[projectId] ?? [], tasks);
  }

  private mergeOrderedTasks(stored: string[], tasks: TaskStore[]): TaskStore[] {
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
    return this.demoteTasksToBottom([...newTasks, ...result]);
  }

  private taskNeedsReview(task: TaskStore): boolean {
    return registeredTaskData(task)?.needsReview === true;
  }

  /**
   * needsReview as used for sorting: the live value, unless reflow is held
   * (pointer inside a task list) — then the value frozen at hold time.
   */
  private taskNeedsReviewForSort(task: TaskStore): boolean {
    return this.frozenNeedsReviewByTaskId?.get(task.data.id) ?? this.taskNeedsReview(task);
  }

  /** Whether the task sinks to the bottom of its group under the active demote rules. */
  private isTaskDemoted(task: TaskStore): boolean {
    if (this.sortNeedsReviewLast && this.taskNeedsReviewForSort(task)) return true;
    if (this.sortArchivingLast && taskIsArchiving(task)) return true;
    return false;
  }

  /**
   * Stable partition: demoted tasks ("稍后再读" / archiving, per settings) sink
   * to the bottom of their group while keeping relative (manual) order intact.
   */
  private demoteTasksToBottom(tasks: TaskStore[]): TaskStore[] {
    if (!this.sortNeedsReviewLast && !this.sortArchivingLast) return tasks;
    return [
      ...tasks.filter((t) => !this.isTaskDemoted(t)),
      ...tasks.filter((t) => this.isTaskDemoted(t)),
    ];
  }

  /**
   * Freeze the needsReview demotion order while the user is interacting with a
   * task list (pointer inside it, or a row context menu open), so toggling
   * "稍后再读" (or an auto-clear on open) doesn't reorder rows under the cursor.
   * Multiple sources hold concurrently — e.g. the pointer leaves the list onto
   * a portal context menu — so holds are keyed by reason and the list only
   * reflows once every reason has released.
   */
  holdTaskReflow(reason: string): void {
    if (!this.sortNeedsReviewLast) return;
    const wasHeld = this.reflowHoldReasons.size > 0;
    this.reflowHoldReasons.add(reason);
    if (wasHeld) return;
    const frozen = new Map<string, boolean>();
    for (const project of this.projectManager.projects.values()) {
      if (!project.mountedProject) continue;
      for (const task of project.mountedProject.taskManager.tasks.values()) {
        frozen.set(task.data.id, this.taskNeedsReview(task));
      }
    }
    this.frozenNeedsReviewByTaskId = frozen;
  }

  releaseTaskReflow(reason: string): void {
    this.reflowHoldReasons.delete(reason);
    if (this.reflowHoldReasons.size === 0) this.frozenNeedsReviewByTaskId = null;
  }

  setTaskOrder(projectId: string, orderedIds: string[]): void {
    this.taskOrderByProject = { ...this.taskOrderByProject, [projectId]: orderedIds };
  }

  private compareSidebarTasks(a: TaskStore, b: TaskStore): number {
    const kind: 'created' | 'updated' = this.taskSortBy === 'created-at' ? 'created' : 'updated';
    return this.compareSidebarTasksBy(a, b, kind);
  }

  private compareSidebarTasksBy(a: TaskStore, b: TaskStore, kind: 'created' | 'updated'): number {
    const da = this.isTaskDemoted(a);
    const db = this.isTaskDemoted(b);
    if (da !== db) return da ? 1 : -1;
    const ia = getSortInstant(a, kind);
    const ib = getSortInstant(b, kind);
    const d = compareSidebarInstantsDesc(ia, ib);
    if (d !== 0) return d;
    return a.data.id.localeCompare(b.data.id);
  }

  private sortTasksForSidebar(tasks: TaskStore[]): TaskStore[] {
    return [...tasks].sort((a, b) => this.compareSidebarTasks(a, b));
  }

  private sortProjectsForSidebar(projects: RegisteredProjectStore[]): RegisteredProjectStore[] {
    if (this.taskSortBy === 'updated-at') {
      // When sorting by recent activity, project order follows each project's
      // monotonic activity stamp (newest first). The stamp advances on new tasks
      // and newer interactions but never regresses on archive, so removing the
      // latest task does not reshuffle the list. Manual DnD order is ignored in
      // this mode — picking "Last used" implies recency should drive layout.
      return [...projects].sort((a, b) => {
        const ra = this.projectActivityById[a.data.id] ?? '';
        const rb = this.projectActivityById[b.data.id] ?? '';
        const d = compareSidebarInstantsDesc(ra, rb);
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
}
