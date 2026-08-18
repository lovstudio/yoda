import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { type LocalProject, type SshProject } from '@shared/projects';
import {
  DEFAULT_STANDALONE_KANBAN_MAX_PANES,
  parseStandaloneKanbanMaxPanes,
  type StandaloneKanbanMaxPanes,
  type StandaloneKanbanPane,
} from '@shared/standalone-kanban-window';
import {
  DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT,
  DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER,
  SIDEBAR_TASK_GROUP_VISIBLE_LIMIT_OPTIONS,
  SIDEBAR_TASK_PRIORITY_GROUPS,
  type SidebarBranchDisplay,
  type SidebarSnapshot,
  type SidebarTaskGroupBy,
  type SidebarTaskGroupVisibleLimit,
  type SidebarTaskPriorityGroup,
  type SidebarTaskSortBy,
} from '@shared/view-state';
import { DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
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
import type { TaskSessionVisibleStatus } from '@renderer/features/tasks/stores/task-selectors';
import { taskViewItemFields } from '@renderer/features/tasks/stores/task-view-item';
import type { WorkspaceStore } from '@renderer/features/workspaces/workspace-store';
import { rpc } from '@renderer/lib/ipc';
import type { AgentRuntimeStore } from '@renderer/lib/stores/agent-runtime-store';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { log } from '@renderer/utils/logger';
import { sidebarGroupId, type ActivityBucket, type SidebarGroupKey } from './sidebar-group';

function parseSidebarTaskSortBy(value: unknown): SidebarTaskSortBy | undefined {
  return value === 'created-at' || value === 'updated-at' ? value : undefined;
}

function parseSidebarTaskGroupBy(value: unknown): SidebarTaskGroupBy | undefined {
  return value === 'project' || value === 'none' || value === 'type' || value === 'activity'
    ? value
    : undefined;
}

function parseSidebarTaskGroupVisibleLimit(
  value: unknown
): SidebarTaskGroupVisibleLimit | undefined {
  return typeof value === 'number' &&
    SIDEBAR_TASK_GROUP_VISIBLE_LIMIT_OPTIONS.some((option) => option === value)
    ? (value as SidebarTaskGroupVisibleLimit)
    : undefined;
}

function parseSidebarBranchDisplay(value: unknown): SidebarBranchDisplay | undefined {
  return value === 'hidden' || value === 'compact' || value === 'full' ? value : undefined;
}

/**
 * Every default order we have ever shipped. A stored order that still matches
 * one of these — or the shape an earlier normalizer rewrote one into — is an
 * untouched default, not a user preference, so it is upgraded to the current
 * default wholesale. Genuinely customized orders keep their sequence, and any
 * group added since they were stored is spliced in beside its default neighbour.
 *
 * Once a superseded default differs from the current one only by a swap, shape
 * alone can no longer tell it apart from a hand-reordered list — that is what
 * `taskPriorityOrderCustomized` is for.
 */
const SUPERSEDED_DEFAULT_SIDEBAR_TASK_PRIORITY_ORDERS: readonly (readonly SidebarTaskPriorityGroup[])[] =
  [
    [
      'awaiting-input',
      'error',
      'completed',
      'working',
      'pending-review',
      'long-term',
      'idle',
      'archived',
    ],
    [
      'awaiting-input',
      'error',
      'completed',
      'working',
      'idle',
      'pending-review',
      'long-term',
      'archived',
    ],
    [
      'awaiting-input',
      'error',
      'completed',
      'interrupted',
      'working',
      'idle',
      'pending-review',
      'long-term',
      'archived',
    ],
  ];

function matchesSidebarTaskPriorityOrder(
  value: unknown,
  order: readonly SidebarTaskPriorityGroup[]
): boolean {
  return (
    Array.isArray(value) &&
    value.length === order.length &&
    value.every((entry, index) => entry === order[index])
  );
}

/**
 * What the previous normalizer turned `order` into: unseen groups appended at
 * the bottom, `archived` pinned last. Recognizing our own rewrite keeps a
 * never-reordered list eligible for a wholesale upgrade — otherwise the first
 * group we ever appended freezes into a preference the user never expressed.
 */
function appendedRewriteOf(order: readonly SidebarTaskPriorityGroup[]): SidebarTaskPriorityGroup[] {
  const kept = order.filter((group) => group !== 'archived');
  const appended = DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER.filter(
    (group) => group !== 'archived' && !kept.includes(group)
  );
  return [...kept, ...appended, 'archived'];
}

function isUntouchedSidebarTaskPriorityOrder(value: unknown): boolean {
  return SUPERSEDED_DEFAULT_SIDEBAR_TASK_PRIORITY_ORDERS.some(
    (order) =>
      matchesSidebarTaskPriorityOrder(value, order) ||
      matchesSidebarTaskPriorityOrder(value, appendedRewriteOf(order))
  );
}

/**
 * Splice a group the stored order has never seen in beside its semantic
 * neighbour: right before the first group that follows it in the shipped
 * default and that the user kept. Appending instead would rank a new status
 * below every existing one — `interrupted` under `idle` — for anyone who had
 * ever reordered a single group.
 */
function insertAtDefaultNeighbour(
  normalized: SidebarTaskPriorityGroup[],
  group: SidebarTaskPriorityGroup
): void {
  const successors = new Set(
    DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER.slice(
      DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER.indexOf(group) + 1
    )
  );
  const at = normalized.findIndex((entry) => successors.has(entry));
  if (at === -1) normalized.push(group);
  else normalized.splice(at, 0, group);
}

export function normalizeSidebarTaskPriorityOrder(
  value: unknown,
  customized = false
): SidebarTaskPriorityGroup[] {
  if (!customized && isUntouchedSidebarTaskPriorityOrder(value)) {
    return [...DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER];
  }
  const valid = new Set<SidebarTaskPriorityGroup>(SIDEBAR_TASK_PRIORITY_GROUPS);
  const seen = new Set<SidebarTaskPriorityGroup>();
  const normalized: SidebarTaskPriorityGroup[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string' || !valid.has(entry as SidebarTaskPriorityGroup)) continue;
      const group = entry as SidebarTaskPriorityGroup;
      if (group === 'archived' || seen.has(group)) continue;
      seen.add(group);
      normalized.push(group);
    }
  }
  for (const group of DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER) {
    if (group === 'archived' || seen.has(group)) continue;
    seen.add(group);
    insertAtDefaultNeighbour(normalized, group);
  }
  normalized.push('archived');
  return normalized;
}

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

/**
 * Routing identity of a task for the agent runtime read model. Available in
 * every state, including `unregistered`: a task whose creation is still in
 * flight already owns its `(projectId, taskId)` pair, and its submitted initial
 * conversation publishes an optimistic status under that key.
 */
function taskRuntimeIdentity(task: TaskStore): { projectId: string; id: string } | null {
  const reg = registeredTaskData(task);
  if (reg) return { projectId: reg.projectId, id: reg.id };
  const u = unregisteredTaskData(task);
  return u ? { projectId: u.projectId, id: u.id } : null;
}

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

export interface SidebarSelectionRevealRequest {
  requestId: number;
  projectId: string;
  taskId?: string;
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
  /** Task-list groups collapsed in type, activity, or priority grouping modes. */
  collapsedTaskGroupIds = observable.set<string>();
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
  taskPriorityMode = false;
  taskPriorityOrder: SidebarTaskPriorityGroup[] = [...DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER];
  /** True once the user reorders a group by hand — see `SidebarSnapshot`. */
  taskPriorityOrderCustomized = false;
  taskGroupVisibleLimit = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT;
  /** Card cap for the standalone agent board — see `standaloneKanbanPanes`. */
  standaloneKanbanMaxPanes: StandaloneKanbanMaxPanes = DEFAULT_STANDALONE_KANBAN_MAX_PANES;
  taskBranchDisplay: SidebarBranchDisplay = 'compact';
  redactTaskContent = false;
  /**
   * Privacy-mode allowlist: these projects (and every task under them) stay
   * legible while redaction is on. Project ids are machine-local, so this list
   * is deliberately not part of the portable settings archive.
   */
  redactionExemptProjectIds = observable.set<string>();
  pinnedCollapsed = false;
  projectsCollapsed = false;
  projectTypeFilter: ProjectTypeFilter = 'all';
  hideProjectsWithoutActiveTasks = false;
  /** Hide tasks that have no non-archived conversation yet. */
  hideTasksWithoutActiveConversations = false;
  /** Legacy snapshot preference. Pending-acceptance tasks are now hidden from the sidebar. */
  sortNeedsReviewLast = false;
  /** Sort tasks with an archive in flight to the bottom of their group. */
  sortArchivingLast = false;
  /**
   * Legacy reflow state retained only to read older snapshots. Pending-acceptance
   * tasks now leave the sidebar instead of being demoted within it.
   */
  private frozenNeedsReviewByTaskId: ReadonlyMap<string, boolean> | null = null;
  /** Active reflow-hold sources (pointer-in-list, open row menu, …). */
  private readonly reflowHoldReasons = new Set<string>();
  /** Global show/hide for the entire secondary nav section. */
  navSectionHidden = false;
  selectionRevealRequest: SidebarSelectionRevealRequest | null = null;
  private nextSelectionRevealRequestId = 1;
  sidebarArchivedTaskLoadState: 'idle' | 'loading' | 'error' = 'idle';
  private sidebarArchivedTaskIdsByProject = observable.map<string, Set<string>>();
  private sidebarArchivedScopeKey = '';
  private sidebarArchivedLoadPromise: Promise<number> | null = null;
  private sidebarArchivedLoadGeneration = 0;

  constructor(
    private readonly projectManager: ProjectManagerStore,
    private readonly workspaceStore: WorkspaceStore,
    private readonly agentRuntime?: Pick<AgentRuntimeStore, 'taskSessionStatuses'> &
      Partial<Pick<AgentRuntimeStore, 'taskStatus'>>
  ) {
    makeAutoObservable(this, {
      expandedProjectIds: false,
      pinnedProjectIds: false,
      collapsedTaskIds: false,
      collapsedTaskGroupIds: false,
      redactionExemptProjectIds: false,
      sidebarRows: computed,
      standaloneKanbanPanes: computed,
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
            this.recordProjectActivity(id, instant);
          }
        });
      },
      { fireImmediately: true }
    );

    reaction(
      () =>
        this.taskPriorityMode
          ? this.getSidebarArchivedProjectIds().join('\u0000')
          : 'priority-mode-disabled',
      (scopeKey, previousScopeKey) => {
        if (scopeKey === previousScopeKey) return;
        if (previousScopeKey !== undefined) this.resetSidebarArchivedTasks();
      }
    );
  }

  /**
   * Task visibility for the main sidebar lists: active (non-archived), plus —
   * when the conversation filter is on — at least one non-archived
   * conversation. Unregistered tasks (creation in flight) always show; their
   * initial conversation does not exist yet.
   */
  private isVisibleSidebarTask(task: TaskStore): boolean {
    if (!this.isTaskEligibleForSidebar(task)) return false;
    if (!this.hideTasksWithoutActiveConversations) return true;
    if (task.state === 'unregistered') return true;
    return Object.values(task.conversationStats).some((count) => count > 0);
  }

  private isTaskEligibleForSidebar(task: TaskStore): boolean {
    if (task.state === 'unregistered') return true;
    const data = registeredTaskData(task);
    return Boolean(data && !data.archivedAt && (this.taskPriorityMode || !data.needsReview));
  }

  private taskRuntimePriorityStatus(task: TaskStore): TaskSessionVisibleStatus | null {
    const identity = taskRuntimeIdentity(task);
    if (!identity) return null;
    const { projectId, id } = identity;
    const runtimeStatuses = new Map(
      (this.agentRuntime?.taskSessionStatuses(projectId, id) ?? []).map(
        ({ conversationId, status }) => [conversationId, status] as const
      )
    );
    const statuses: TaskSessionVisibleStatus[] = [];
    if (task.state === 'provisioned' && task.provisionedTask) {
      for (const conversation of task.provisionedTask.conversations.conversations.values()) {
        const status = runtimeStatuses.get(conversation.data.id) ?? conversation.indicatorStatus;
        if (status && status !== 'idle') statuses.push(status);
        runtimeStatuses.delete(conversation.data.id);
      }
    }
    statuses.push(...runtimeStatuses.values());
    // Opening a task consumes completed/error notifications, but that is only
    // an acknowledgement action. Preserve the terminal grouping when no live
    // or unread session state supersedes it.
    if (statuses.length === 0) {
      const retainedStatus = this.agentRuntime?.taskStatus?.(projectId, id);
      if (retainedStatus && retainedStatus !== 'idle') statuses.push(retainedStatus);
    }
    const priority: Record<TaskSessionVisibleStatus, number> = {
      'awaiting-input': 0,
      error: 1,
      completed: 2,
      interrupted: 3,
      working: 4,
      // Directly after `working`, matching every other surface's ordering.
      background: 5,
    };
    return statuses.sort((left, right) => priority[left] - priority[right])[0] ?? null;
  }

  /**
   * A task's live status, as the product names it. Public because every surface
   * that lists tasks (sidebar, kanban view, standalone board) must classify a
   * task identically — see `@shared/task-view-options`.
   */
  taskPriorityGroup(task: TaskStore): SidebarTaskPriorityGroup {
    const data = registeredTaskData(task);
    if (data?.archivedAt) return 'archived';

    // A task being created is not yet in the DB, but its submitted initial
    // conversation already published an optimistic runtime status. Read it, so
    // a task that starts working never renders an idle frame first and then
    // jumps groups once the create RPC settles.
    const runtimeStatus = this.taskRuntimePriorityStatus(task);
    if (runtimeStatus === 'awaiting-input') return 'awaiting-input';
    if (
      runtimeStatus === 'error' ||
      task.phase?.endsWith('-error') === true ||
      data?.setupStatus === 'naming_failed' ||
      data?.setupStatus === 'branch_failed' ||
      Boolean(data?.setupError)
    ) {
      return 'error';
    }
    // A finished turn that still owns a detached job keeps the task grouped as
    // working: the task genuinely has work in flight, and letting it fall
    // through would drop it past `completed` into `idle`.
    if (runtimeStatus === 'working' || runtimeStatus === 'background') return 'working';
    if (!data) return runtimeStatus === 'interrupted' ? 'interrupted' : 'idle';
    if (data.needsReview || data.status === 'review') return 'pending-review';
    if (runtimeStatus === 'completed' || data.status === 'done' || data.status === 'cancelled') {
      return 'completed';
    }
    // A turn that was cut short — by Esc or by the process dying. Grouped apart
    // from `completed` because the work did not finish, and apart from `idle`
    // because something actually happened.
    if (runtimeStatus === 'interrupted') return 'interrupted';
    if (data.isLongTerm) return 'long-term';
    return 'idle';
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
      .filter((p) => this.matchesActiveWorkspace(p))
      // With the hide filter on, a freshly picked/quick-created project (mode
      // 'pick') lands empty and the filter will hide it — so don't flash it in
      // during its brief registering phase only to drop it on mount. Clone/new
      // keep showing so their long-running progress stays visible.
      .filter((p) => !this.hideProjectsWithoutActiveTasks || p.mode !== 'pick');
    const real = all.filter(isRegisteredProject).filter((p) => this.matchesActiveWorkspace(p));

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
    if (this.taskPriorityMode) return this.priorityGroupedRows();
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

  /**
   * Every candidate for the standalone agent board: kanban-ranked tasks that
   * already have at least one agent session.
   *
   * Ranked by `priorityGroupedRows()` regardless of the sidebar's current mode —
   * the board is an action, not a sidebar mode, so its contents must not shift
   * when the user switches the sidebar back to the standard list. Membership is
   * "has a session", not "is running": a card that vanished the moment its
   * agent finished would defeat the point of watching it.
   *
   * Deliberately uncapped: the board filters and sorts this list and applies its
   * card cap afterwards, so filtering surfaces the next matching sessions instead
   * of thinning an already-truncated set. Each entry carries a full
   * `TaskViewItem` because the board window only mounts the projects it ends up
   * showing and cannot resolve those fields itself.
   */
  get standaloneKanbanPanes(): StandaloneKanbanPane[] {
    const panes: StandaloneKanbanPane[] = [];
    for (const row of this.priorityGroupedRows()) {
      if (row.kind !== 'task') continue;
      const project = this.projectManager.projects.get(row.projectId);
      if (!project) continue;
      const projectName =
        project.state === 'unregistered' ? row.projectId : project.displayName || row.projectId;
      const task = project.mountedProject?.taskManager.tasks.get(row.taskId);
      if (!task || registeredTaskData(task)?.archivedAt) continue;
      if (!Object.values(task.conversationStats).some((count) => count > 0)) continue;
      panes.push({
        projectId: row.projectId,
        taskId: row.taskId,
        ...taskViewItemFields(task, this.taskPriorityGroup(task), projectName),
      });
    }
    return panes;
  }

  private priorityGroupedRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    const buckets = new Map<SidebarTaskPriorityGroup, { projectId: string; task: TaskStore }[]>();
    const orderedProjectIds = new Set(
      this.orderedProjects.map((project) =>
        project.state === 'unregistered' ? project.id : project.data!.id
      )
    );
    let archivedCount = 0;

    for (const project of this.projectManager.projects.values()) {
      const projectId = project.state === 'unregistered' ? project.id : project.data?.id;
      if (!projectId) continue;
      if (!project.mountedProject) continue;
      const includeWholeProject =
        orderedProjectIds.has(projectId) ||
        (project.state !== 'unregistered' &&
          this.isProjectPinned(projectId) &&
          this.matchesActiveWorkspace(project));
      const projectWorkspaceId =
        project.state === 'unregistered' ? null : (project.data?.workspaceId ?? null);

      for (const task of project.mountedProject.taskManager.tasks.values()) {
        const taskWorkspaceId =
          'sidebarWorkspaceId' in task.data ? task.data.sidebarWorkspaceId : undefined;
        const includePinnedTask =
          task.data.isPinned &&
          this.workspaceStore.matchesActive(taskWorkspaceId ?? projectWorkspaceId);
        if (!includeWholeProject && !includePinnedTask) {
          continue;
        }
        const data = registeredTaskData(task);
        const isSidebarArchivedTask = Boolean(
          data?.archivedAt && this.sidebarArchivedTaskIdsByProject.get(projectId)?.has(data.id)
        );
        if (data?.archivedAt) {
          if (!includeWholeProject || !isSidebarArchivedTask) continue;
        } else if (!this.isVisibleSidebarTask(task)) {
          continue;
        }
        const priority = this.taskPriorityGroup(task);
        const bucket = buckets.get(priority) ?? [];
        bucket.push({ projectId, task });
        buckets.set(priority, bucket);
      }

      if (includeWholeProject) {
        archivedCount +=
          project.mountedProject.taskManager.taskCounts?.archived ??
          Array.from(project.mountedProject.taskManager.tasks.values()).filter(
            (task) => registeredTaskData(task)?.archivedAt
          ).length;
      }
    }

    for (const priority of this.taskPriorityOrder) {
      const tasks = buckets.get(priority) ?? [];
      const count = priority === 'archived' ? archivedCount : tasks.length;
      if (count === 0) continue;
      rows.push({ kind: 'group', group: { kind: 'priority', priority, count } });
      tasks.sort((left, right) => this.compareSidebarTasks(left.task, right.task));
      for (const { projectId, task } of tasks) {
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

  private projectGroupedRows(): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const project of this.orderedProjects) {
      const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
      if (project.state !== 'unregistered' && this.isProjectPinned(projectId)) continue;
      rows.push({ kind: 'project', projectId });
      if (this.expandedProjectIds.has(projectId) && project.mountedProject) {
        const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter((task) =>
          this.isVisibleSidebarTask(task)
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
            (task) => this.isVisibleSidebarTask(task)
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
        if (!this.isVisibleSidebarTask(task)) continue;
        if (task.data.isPinned) continue;
        pairs.push({ projectId, task });
      }
    }
    return pairs;
  }

  /** Pinned projects plus pinned tasks that are not already under a pinned project. */
  get pinnedSidebarEntries(): PinnedSidebarEntry[] {
    if (this.taskPriorityMode) return [];
    const entries: PinnedSidebarEntry[] = [];
    const pinnedProjectIds = new Set(this.pinnedProjectIds);
    const pinnedProjects = this.sortProjectsForSidebar(
      Array.from(this.projectManager.projects.values())
        .filter(isRegisteredProject)
        .filter((p) => this.matchesActiveWorkspace(p))
    ).filter((project) => pinnedProjectIds.has(project.data.id));

    for (const project of pinnedProjects) {
      const projectId = project.data.id;
      entries.push({ kind: 'project', projectId });
      if (!this.expandedProjectIds.has(projectId) || !project.mountedProject) continue;

      const tasks = Array.from(project.mountedProject.taskManager.tasks.values()).filter((task) =>
        this.isTaskEligibleForSidebar(task)
      );
      const manualOrder = this.taskOrderByProject[projectId];
      const ordered =
        !this.taskPriorityMode && manualOrder?.length
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
        if (!this.isTaskEligibleForSidebar(task) || !task.data.isPinned) continue;
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
      collapsedTaskGroupIds: [...this.collapsedTaskGroupIds],
      projectActivityById: { ...this.projectActivityById },
      taskSortBy: this.taskSortBy,
      taskGroupBy: this.taskGroupBy,
      taskPriorityMode: this.taskPriorityMode,
      taskPriorityOrder: [...this.taskPriorityOrder],
      taskPriorityOrderCustomized: this.taskPriorityOrderCustomized,
      taskGroupVisibleLimit: this.taskGroupVisibleLimit,
      standaloneKanbanMaxPanes: this.standaloneKanbanMaxPanes,
      taskBranchDisplay: this.taskBranchDisplay,
      redactTaskContent: this.redactTaskContent,
      redactionExemptProjectIds: [...this.redactionExemptProjectIds],
      pinnedProjectIds: [...this.pinnedProjectIds],
      pinnedCollapsed: this.pinnedCollapsed,
      projectsCollapsed: this.projectsCollapsed,
      hideProjectsWithoutActiveTasks: this.hideProjectsWithoutActiveTasks,
      hideTasksWithoutActiveConversations: this.hideTasksWithoutActiveConversations,
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
    if (snapshot.collapsedTaskGroupIds !== undefined) {
      this.collapsedTaskGroupIds.replace(snapshot.collapsedTaskGroupIds);
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
    if (snapshot.taskPriorityMode !== undefined) {
      this.taskPriorityMode = snapshot.taskPriorityMode === true;
    }
    if (snapshot.taskPriorityOrderCustomized !== undefined) {
      this.taskPriorityOrderCustomized = snapshot.taskPriorityOrderCustomized === true;
    }
    if (snapshot.taskPriorityOrder !== undefined) {
      this.taskPriorityOrder = normalizeSidebarTaskPriorityOrder(
        snapshot.taskPriorityOrder,
        this.taskPriorityOrderCustomized
      );
    }
    if (snapshot.taskGroupVisibleLimit !== undefined) {
      const v = parseSidebarTaskGroupVisibleLimit(snapshot.taskGroupVisibleLimit);
      if (v !== undefined) this.taskGroupVisibleLimit = v;
    }
    if (snapshot.standaloneKanbanMaxPanes !== undefined) {
      const v = parseStandaloneKanbanMaxPanes(snapshot.standaloneKanbanMaxPanes);
      if (v !== undefined) this.standaloneKanbanMaxPanes = v;
    }
    if (snapshot.taskBranchDisplay !== undefined) {
      const v = parseSidebarBranchDisplay(snapshot.taskBranchDisplay);
      if (v !== undefined) this.taskBranchDisplay = v;
    }
    if (snapshot.redactTaskContent !== undefined) {
      this.redactTaskContent = snapshot.redactTaskContent === true;
    }
    if (snapshot.redactionExemptProjectIds !== undefined) {
      this.redactionExemptProjectIds.replace(snapshot.redactionExemptProjectIds);
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
    if (snapshot.hideTasksWithoutActiveConversations !== undefined) {
      this.hideTasksWithoutActiveConversations =
        snapshot.hideTasksWithoutActiveConversations === true;
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

  toggleTaskGroupCollapsed(group: SidebarGroupKey): void {
    const groupId = sidebarGroupId(group);
    if (this.collapsedTaskGroupIds.has(groupId)) {
      this.collapsedTaskGroupIds.delete(groupId);
    } else {
      this.collapsedTaskGroupIds.add(groupId);
    }
  }

  ensureTaskGroupExpanded(group: SidebarGroupKey): void {
    this.collapsedTaskGroupIds.delete(sidebarGroupId(group));
  }

  /**
   * Archived tasks live in the database, not in memory — the group is hydrated
   * one page at a time. An expanded group must hold at least its first page, or
   * it opens onto nothing but its own disclosure row.
   */
  ensureSidebarArchivedTasksHydrated(): void {
    if (!this.taskPriorityMode) return;
    if (this.sidebarArchivedTaskIdsByProject.size > 0) return;
    if (this.sidebarArchivedTaskLoadState === 'error') return;
    void this.loadMoreSidebarArchivedTasks(this.taskGroupVisibleLimit).catch(() => {});
  }

  /**
   * Moves whenever archived hydration is discarded or extended. A scope change
   * (project mounts, workspace switch, pin/unpin) releases every hydrated
   * archived task, and the group's header count still comes from the database —
   * so without re-hydrating, an open group renders nothing but its own "show
   * more" row. Consumers read this to re-run hydration on reset.
   */
  get sidebarArchivedHydrationToken(): string {
    let hydratedCount = 0;
    for (const taskIds of this.sidebarArchivedTaskIdsByProject.values()) {
      hydratedCount += taskIds.size;
    }
    return `${this.sidebarArchivedScopeKey} ${hydratedCount}`;
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

  setHideTasksWithoutActiveConversations(hidden: boolean): void {
    this.hideTasksWithoutActiveConversations = hidden;
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

  setRedactTaskContent(redacted: boolean): void {
    this.redactTaskContent = redacted;
  }

  /** Whether this project sits on the privacy allowlist (never blurred). */
  isProjectRedactionExempt(projectId: string): boolean {
    return this.redactionExemptProjectIds.has(projectId);
  }

  /**
   * Single answer to "should this project's rows be obscured?" — privacy mode
   * on, minus the allowlist. Every sidebar surface reads this, so a project and
   * its tasks are always redacted (or not) together.
   */
  isProjectRedacted(projectId: string): boolean {
    return this.redactTaskContent && !this.redactionExemptProjectIds.has(projectId);
  }

  setProjectRedactionExempt(projectId: string, exempt: boolean): void {
    if (exempt) this.redactionExemptProjectIds.add(projectId);
    else this.redactionExemptProjectIds.delete(projectId);
  }

  toggleProjectRedactionExempt(projectId: string): void {
    this.setProjectRedactionExempt(projectId, !this.redactionExemptProjectIds.has(projectId));
  }

  clearRedactionExemptProjects(): void {
    this.redactionExemptProjectIds.clear();
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

  /** Advances a project's monotonic task-activity stamp. */
  recordProjectActivity(projectId: string, instant: string = new Date().toISOString()): void {
    const current = this.projectActivityById[projectId] ?? '';
    // compareSidebarInstantsDesc < 0 means `instant` is newer than `current`.
    if (compareSidebarInstantsDesc(instant, current) < 0) {
      this.projectActivityById[projectId] = instant;
    }
  }

  /**
   * Reveals the routed project/task in the sidebar without fighting subsequent
   * manual collapses. Call when the navigation selection itself changes or
   * when an asynchronously loaded target first becomes available.
   */
  revealSelection(projectId: string, taskId?: string): void {
    const project = this.projectManager.projects.get(projectId);
    if (!project) return;

    const mountedProject = project.mountedProject;
    const task = taskId ? mountedProject?.taskManager.tasks.get(taskId) : undefined;
    const projectWorkspaceId =
      project.state === 'unregistered'
        ? (project.pendingWorkspaceId ?? null)
        : (project.data?.workspaceId ?? null);
    const taskWorkspaceId =
      task && 'sidebarWorkspaceId' in task.data ? task.data.sidebarWorkspaceId : undefined;
    const targetWorkspaceId = taskWorkspaceId ?? projectWorkspaceId;
    if (this.workspaceStore.isFiltering && !this.workspaceStore.matchesActive(targetWorkspaceId)) {
      this.workspaceStore.setActiveWorkspaceId(targetWorkspaceId ?? DEFAULT_WORKSPACE_ID);
    }

    const targetIsPinned = this.isProjectPinned(projectId) || task?.data.isPinned === true;
    if (targetIsPinned) {
      this.pinnedCollapsed = false;
    } else {
      this.projectsCollapsed = false;
    }

    const targetGroup = this.taskGroupForSelection(project, task);
    if (targetGroup) this.ensureTaskGroupExpanded(targetGroup);

    this.ensureProjectExpanded(projectId);
    if (!task || !mountedProject) return;

    const tasks = mountedProject.taskManager.tasks;
    let parentTaskId = registeredTaskData(task)?.parentTaskId;
    for (let steps = 0; steps <= tasks.size && parentTaskId; steps += 1) {
      this.collapsedTaskIds.delete(parentTaskId);
      const parent = tasks.get(parentTaskId);
      parentTaskId = parent ? registeredTaskData(parent)?.parentTaskId : undefined;
    }
  }

  private taskGroupForSelection(
    project: ProjectStore,
    task: TaskStore | undefined
  ): SidebarGroupKey | null {
    if (this.taskPriorityMode) {
      return task ? { kind: 'priority', priority: this.taskPriorityGroup(task), count: 0 } : null;
    }
    if (this.taskGroupBy === 'type') {
      return {
        kind: 'type',
        type: project.state === 'unregistered' ? 'local' : project.data!.type,
      };
    }
    if (this.taskGroupBy === 'activity' && task) {
      return {
        kind: 'activity',
        bucket: activityBucketFor(getSortInstant(task, 'updated')),
      };
    }
    return null;
  }

  /**
   * Requests an explicit, one-shot sidebar reveal from a surface that stays on
   * its current route, such as Home's selected-project locator.
   */
  requestSelectionReveal(projectId: string, taskId?: string): void {
    const project = this.projectManager.projects.get(projectId);
    if (project) {
      const task = taskId ? project.mountedProject?.taskManager.tasks.get(taskId) : undefined;
      const targetIsPinned = this.isProjectPinned(projectId) || task?.data.isPinned === true;

      if (!targetIsPinned) {
        // A locator is an explicit request to make the target row visible.
        // Relax only the view options that currently exclude that project.
        const targetProjectType = project.state === 'unregistered' ? 'local' : project.data?.type;
        if (this.projectTypeFilter !== 'all' && targetProjectType !== this.projectTypeFilter) {
          this.projectTypeFilter = 'all';
        }

        const hiddenByProjectPresence =
          this.hideProjectsWithoutActiveTasks &&
          (project.state === 'unregistered'
            ? project.mode === 'pick'
            : !this.shouldShowProjectByTaskPresence(project));
        if (hiddenByProjectPresence) {
          this.hideProjectsWithoutActiveTasks = false;
        }

        if (!taskId && (this.taskGroupBy === 'none' || this.taskGroupBy === 'activity')) {
          this.applyGroupBy('project');
        }
      }
    }

    this.revealSelection(projectId, taskId);
    this.selectionRevealRequest = {
      requestId: this.nextSelectionRevealRequestId,
      projectId,
      ...(taskId ? { taskId } : {}),
    };
    this.nextSelectionRevealRequestId += 1;
  }

  completeSelectionReveal(requestId: number): void {
    if (this.selectionRevealRequest?.requestId === requestId) {
      this.selectionRevealRequest = null;
    }
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

  setTaskPriorityMode(enabled: boolean): void {
    if (!enabled) this.resetSidebarArchivedTasks();
    this.taskPriorityMode = enabled;
  }

  toggleTaskPriorityMode(): void {
    this.setTaskPriorityMode(!this.taskPriorityMode);
  }

  async loadMoreSidebarArchivedTasks(limit: number): Promise<number> {
    if (!this.taskPriorityMode || limit <= 0) return 0;
    if (this.sidebarArchivedLoadPromise) return this.sidebarArchivedLoadPromise;

    const projectIds = this.getSidebarArchivedProjectIds();
    if (projectIds.length === 0) return 0;
    const scopeKey = projectIds.join('\u0000');
    if (this.sidebarArchivedScopeKey && this.sidebarArchivedScopeKey !== scopeKey) {
      this.resetSidebarArchivedTasks();
    }
    this.sidebarArchivedScopeKey = scopeKey;
    const generation = this.sidebarArchivedLoadGeneration;
    const offset = Array.from(this.sidebarArchivedTaskIdsByProject.values()).reduce(
      (total, taskIds) => total + taskIds.size,
      0
    );
    this.sidebarArchivedTaskLoadState = 'loading';

    const promise = rpc.tasks
      .getArchivedTasksPage(projectIds, offset, limit)
      .then((tasks) => {
        if (
          !this.taskPriorityMode ||
          generation !== this.sidebarArchivedLoadGeneration ||
          scopeKey !== this.sidebarArchivedScopeKey
        ) {
          return 0;
        }

        let addedCount = 0;
        const tasksByProject = new Map<string, typeof tasks>();
        for (const task of tasks) {
          const projectTasks = tasksByProject.get(task.projectId) ?? [];
          projectTasks.push(task);
          tasksByProject.set(task.projectId, projectTasks);
        }
        runInAction(() => {
          for (const [projectId, projectTasks] of tasksByProject) {
            const project = this.projectManager.projects.get(projectId);
            const taskManager = project?.mountedProject?.taskManager;
            if (!taskManager) continue;
            const hydratedTaskIds = taskManager.hydrateSidebarArchivedTasks(projectTasks);
            const taskIds =
              this.sidebarArchivedTaskIdsByProject.get(projectId) ?? new Set<string>();
            for (const taskId of hydratedTaskIds) {
              if (!taskIds.has(taskId)) addedCount += 1;
              taskIds.add(taskId);
            }
            this.sidebarArchivedTaskIdsByProject.set(projectId, taskIds);
          }
          this.sidebarArchivedTaskLoadState = 'idle';
        });
        return addedCount;
      })
      .catch((error: unknown) => {
        if (generation === this.sidebarArchivedLoadGeneration) {
          runInAction(() => {
            this.sidebarArchivedTaskLoadState = 'error';
          });
        }
        log.warn('SidebarStore: failed to load archived task page', {
          projectIds,
          offset,
          limit,
          error,
        });
        throw error;
      })
      .finally(() => {
        if (this.sidebarArchivedLoadPromise === promise) {
          this.sidebarArchivedLoadPromise = null;
        }
      });
    this.sidebarArchivedLoadPromise = promise;
    return promise;
  }

  private getSidebarArchivedProjectIds(): string[] {
    const orderedProjectIds = new Set(
      this.orderedProjects.map((project) =>
        project.state === 'unregistered' ? project.id : project.data!.id
      )
    );
    const projectIds: string[] = [];
    for (const project of this.projectManager.projects.values()) {
      if (!project.mountedProject || project.state === 'unregistered' || !project.data) continue;
      const projectId = project.data.id;
      const included =
        orderedProjectIds.has(projectId) ||
        (this.isProjectPinned(projectId) && this.matchesActiveWorkspace(project));
      if (included) projectIds.push(projectId);
    }
    return projectIds.sort();
  }

  private resetSidebarArchivedTasks(): void {
    this.sidebarArchivedLoadGeneration += 1;
    this.sidebarArchivedLoadPromise = null;
    for (const [projectId, taskIds] of this.sidebarArchivedTaskIdsByProject) {
      this.projectManager.projects
        .get(projectId)
        ?.mountedProject?.taskManager.releaseSidebarArchivedTasks([...taskIds]);
    }
    this.sidebarArchivedTaskIdsByProject.clear();
    this.sidebarArchivedScopeKey = '';
    this.sidebarArchivedTaskLoadState = 'idle';
  }

  moveTaskPriorityGroup(group: SidebarTaskPriorityGroup, direction: -1 | 1): void {
    if (group === 'archived') return;
    const movable = this.taskPriorityOrder.filter((entry) => entry !== 'archived');
    const index = movable.indexOf(group);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= movable.length) return;
    [movable[index], movable[target]] = [movable[target]!, movable[index]!];
    this.setTaskPriorityOrder(movable);
  }

  /**
   * The whole ranking at once — what a drag produces. Normalizing keeps
   * `archived` pinned last and splices back any group the caller dropped, so a
   * partial list can never delete a status from the sidebar.
   */
  setTaskPriorityOrder(order: readonly SidebarTaskPriorityGroup[]): void {
    this.taskPriorityOrder = normalizeSidebarTaskPriorityOrder([...order], true);
    this.taskPriorityOrderCustomized = true;
  }

  resetTaskPriorityOrder(): void {
    this.taskPriorityOrder = [...DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER];
    this.taskPriorityOrderCustomized = false;
  }

  setTaskGroupVisibleLimit(limit: SidebarTaskGroupVisibleLimit): void {
    this.taskGroupVisibleLimit = limit;
  }

  setStandaloneKanbanMaxPanes(max: StandaloneKanbanMaxPanes): void {
    this.standaloneKanbanMaxPanes = max;
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

  /** Whether an active task sinks to the bottom of its group while archiving. */
  private isTaskDemoted(task: TaskStore): boolean {
    if (this.sortArchivingLast && taskIsArchiving(task)) return true;
    return false;
  }

  /**
   * Stable partition: tasks archiving in flight sink to the bottom of their
   * group while keeping relative (manual) order intact.
   */
  private demoteTasksToBottom(tasks: TaskStore[]): TaskStore[] {
    if (!this.sortArchivingLast) return tasks;
    return [
      ...tasks.filter((t) => !this.isTaskDemoted(t)),
      ...tasks.filter((t) => this.isTaskDemoted(t)),
    ];
  }

  /**
   * Retained for snapshot compatibility with the legacy read-later preference.
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
    if (this.taskPriorityMode) {
      const priorityDifference =
        this.taskPriorityOrder.indexOf(this.taskPriorityGroup(a)) -
        this.taskPriorityOrder.indexOf(this.taskPriorityGroup(b));
      if (priorityDifference !== 0) return priorityDifference;
    }
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
        // Fall back to the project's own timestamp when it has no task-activity
        // stamp yet (e.g. a freshly created, task-less project). Without this a
        // brand-new project sinks to mid-list under recency sort, but it was
        // force-prepended to the top during its `unregistered` phase — so it
        // visibly jumps from top to middle on mount. Anchoring to createdAt/
        // updatedAt (≈ now for a new project) keeps it at the top throughout.
        const ra =
          this.projectActivityById[a.data.id] || a.data.updatedAt || a.data.createdAt || '';
        const rb =
          this.projectActivityById[b.data.id] || b.data.updatedAt || b.data.createdAt || '';
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
      if (!this.isTaskEligibleForSidebar(task)) continue;
      const instant = getSortInstant(task, 'updated');
      if (instant && (!best || compareSidebarInstantsDesc(instant, best) < 0)) best = instant;
    }
    return best;
  }

  private shouldShowProjectByTaskPresence(project: ProjectStore): boolean {
    if (!project.mountedProject) {
      // A project created this session went through `unregistered`, so `mode`
      // is set. Keep it hidden until it actually has a visible task, so a brand
      // new empty project never appears then vanishes when it mounts empty.
      // Startup-loaded projects (mode === null) stay shown while mounting so
      // they don't pop in after their tasks load.
      return project.mode === null;
    }
    if (project.mountedProject.taskManager.taskLoadState !== 'loaded') {
      return project.mode === null;
    }
    // Uses the full visibility predicate so the two hide filters compose: a
    // project whose remaining tasks are all conversation-less hides too.
    return Array.from(project.mountedProject.taskManager.tasks.values()).some((task) =>
      this.isVisibleSidebarTask(task)
    );
  }
}
