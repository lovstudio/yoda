import type { GitChangeStatus, GitObjectRef } from '@shared/git';

export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type TabDescriptor =
  | { kind: 'conversation'; tabId: string; conversationId: string; isPreview: boolean }
  | { kind: 'file'; tabId: string; path: string; isPreview: boolean }
  | {
      kind: 'diff';
      tabId: string;
      path: string;
      diffGroup: 'disk' | 'staged' | 'git' | 'pr';
      originalRef: GitObjectRef;
      modifiedRef?: GitObjectRef;
      prNumber?: number;
      status?: GitChangeStatus;
      isPreview: boolean;
    };

export type TabManagerSnapshot = {
  tabs: TabDescriptor[];
  activeTabId: string | undefined;
  /** @deprecated Legacy single side-pane slot — migrated into `sidebarTabs` on restore. */
  sidePaneTab?: TabDescriptor;
  /** Tabs pinned into the task sidebar strip. Live outside `tabs`/tab order. */
  sidebarTabs?: TabDescriptor[];
  /** The pinned sidebar tab selected in the sidebar strip, if any. */
  activeSidebarTabId?: string;
};

export type EditorViewSnapshot = {
  expandedPaths: string[];
};

export type DiffViewSnapshot = {
  diffStyle: 'unified' | 'split';
  viewMode: 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | null;
  prTab?: 'files' | 'commits' | 'checks';
};

export interface ActiveFile {
  path: string;
  /** Storage layer: how content is fetched.
   *  'disk' = working-tree read (disk://)
   *  'git'  = git-object read (git://) */
  type: 'disk' | 'git';
  /** Semantic context: which diff panel/group this file belongs to.
   *  Determines which side is original/modified and which events make it stale.
   *  'disk'   = working tree vs HEAD
   *  'staged' = index vs HEAD
   *  'git'    = arbitrary ref-to-ref comparison
   *  'pr'     = PR diff (originalRef is remote-tracking base) */
  group: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  /** PR head SHA for the modified side of a 'pr' group diff.
   *  When absent the diff stack falls back to HEAD_REF. */
  modifiedRef?: GitObjectRef;
  /** Set only when group === 'pr'. Identifies the PR for store lookups. */
  prNumber?: number;
}

export type TaskViewSnapshot = {
  /** @deprecated Sidebar chrome is now stored globally in TaskSidebarViewSnapshot. */
  sidebarTab?: string;
  /** @deprecated Sidebar chrome is now stored globally in TaskSidebarViewSnapshot. */
  isSidebarCollapsed?: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen?: boolean;
  tabManager?: TabManagerSnapshot;
  /** @deprecated Legacy field from before the unified tab refactor. Used only for migration. */
  conversations?: TabViewSnapshot;
  terminals?: TabViewSnapshot;
  editor?: EditorViewSnapshot;
  diffView?: DiffViewSnapshot;
};

export type TaskSidebarViewSnapshot = {
  sidebarTab?: string;
  isSidebarCollapsed?: boolean;
  /** Feature cards (session/changes/files) added to the sidebar strip. */
  openSidebarGroups?: string[];
  sessionPanelOpenSectionIds?: string[];
  /** Display order of the Session panel units; missing units append in default order. */
  sessionPanelUnitOrder?: string[];
  /** Session panel units the user has hidden. */
  sessionPanelHiddenUnits?: string[];
  /** Open ids for ad-hoc disclosures (`<details>`, group toggles) across panels. */
  disclosureOpenIds?: string[];
};

export type ProjectViewSnapshot = {
  activeView: string;
  taskViewTab: 'active' | 'archived';
  taskViewArchivedOnlyWithNote?: boolean;
};

export type NavigationSnapshot = {
  currentViewId: string;
  viewParams: Record<string, unknown>;
};

/** Persisted top-level app tabs (scoped navigation contexts). */
export type AppTabsSnapshot = {
  tabs: { id: string; viewId: string; params: Record<string, unknown>; seq?: number }[];
  activeTabId: string | null;
};

export type SidebarTaskSortBy = 'created-at' | 'updated-at';

export type SidebarTaskGroupBy = 'project' | 'none' | 'type' | 'activity';

/**
 * How task rows render their branch name:
 * - `hidden`: no branch info.
 * - `compact`: subtle trailing mono label on the name line (32px row kept).
 * - `full`: dedicated second line with the full branch name.
 */
export type SidebarBranchDisplay = 'hidden' | 'compact' | 'full';

/** Persisted sidebar UI state; fields may be absent in older DB blobs. */
export type SidebarSnapshot = {
  expandedProjectIds?: string[];
  projectOrder?: string[];
  taskOrderByProject?: Record<string, string[]>;
  /** Manual order of subtasks per parent task id (root tasks use taskOrderByProject). */
  taskOrderByParent?: Record<string, string[]>;
  /** Task ids whose subtask subtree is collapsed in the sidebar (default expanded). */
  collapsedTaskIds?: string[];
  projectActivityById?: Record<string, string>;
  taskSortBy?: SidebarTaskSortBy;
  taskGroupBy?: SidebarTaskGroupBy;
  taskBranchDisplay?: SidebarBranchDisplay;
  pinnedProjectIds?: string[];
  pinnedCollapsed?: boolean;
  projectsCollapsed?: boolean;
  hideProjectsWithoutActiveTasks?: boolean;
  /** Sort tasks marked "稍后再读" (needsReview) to the bottom of their group. */
  sortNeedsReviewLast?: boolean;
  /** Sort tasks with an archive in flight (archiveRequestedAt set) to the bottom of their group. */
  sortArchivingLast?: boolean;
  activeWorkspaceId?: string;
  /** Global show/hide for the entire secondary nav section at the sidebar bottom. */
  navSectionHidden?: boolean;
};
