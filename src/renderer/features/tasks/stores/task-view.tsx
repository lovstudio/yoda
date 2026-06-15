import { computed, makeAutoObservable, reaction, runInAction } from 'mobx';
import type { BottomPanelTab, TaskViewSnapshot } from '@shared/view-state';
import { TaskBrowserStore } from '@renderer/features/tasks/browser/browser-store';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { DiffTabLifecycleStore } from '@renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { GitStore } from '@renderer/features/tasks/diff-view/stores/git-store';
import { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import type { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import {
  sidebarGroupForTab,
  type SidebarTab,
  type SidebarTabGroup,
} from '@renderer/features/tasks/types';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { taskSidebarPreferenceStore } from './task-sidebar-preferences';

/**
 * Identifies which content renderer is active in the main panel.
 * - `'monaco'`      — persistent Monaco editor for plain text / code files
 * - `'markdown'`    — markdown files (preview or source; MarkdownEditorPanel owns both)
 * - `'diff'`        — git diff viewer
 * - `'agents'`      — conversation / PTY view
 * - `'other-file'`  — image, svg preview, pdf, binary, too-large, file-error
 */
export type RendererKind = 'overview' | 'monaco' | 'markdown' | 'diff' | 'agents' | 'other-file';

interface TaskViewResources {
  conversations: ConversationManagerStore;
  terminals: TerminalManagerStore;
  git: GitStore;
  pr: PrStore;
  projectId: string;
  taskId: string;
  workspaceId: string;
}

type TaskRouteParams = { projectId?: string; taskId?: string };

function activeTaskRouteMatches(projectId: string, taskId: string): boolean {
  const params = appState.navigation.viewParamsStore['task'] as TaskRouteParams | undefined;
  return (
    appState.navigation.currentViewId === 'task' &&
    params?.projectId === projectId &&
    params.taskId === taskId
  );
}

function isTaskViewHistoryEntry(entry: HistoryEntry, projectId: string, taskId: string): boolean {
  if (entry.kind !== 'view' || entry.viewId !== 'task') return false;
  const params = entry.params as TaskRouteParams;
  return params.projectId === projectId && params.taskId === taskId;
}

export class TaskViewStore {
  focusedRegion: 'main' | 'bottom';
  /** Ephemeral: sidebar expanded over the whole upper main view. */
  isSidebarMaximized = false;

  readonly tabManager: TabManagerStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: FileModelLifecycleStore;
  readonly diffView: DiffViewStore;
  /** The task's single resident in-app browser card. */
  readonly browser: TaskBrowserStore;
  private readonly diffTabLifecycle: DiffTabLifecycleStore;
  private readonly terminalsMgr: TerminalManagerStore;
  private readonly disposers: (() => void)[] = [];
  private readonly taskId: string;

  constructor(resources: TaskViewResources, savedSnapshot?: TaskViewSnapshot) {
    this.taskId = resources.taskId;
    this.focusedRegion = savedSnapshot?.focusedRegion === 'bottom' ? 'bottom' : 'main';
    this.terminalsMgr = resources.terminals;

    this.tabManager = new TabManagerStore(resources.conversations, resources.workspaceId);
    this.terminalTabs = new TerminalTabViewStore(resources.terminals);
    this.diffView = new DiffViewStore(resources.git, resources.pr);
    this.browser = new TaskBrowserStore(savedSnapshot?.browser);

    // Restore tab state from the unified tabManager snapshot.
    if (savedSnapshot?.tabManager) {
      this.tabManager.restoreSnapshot(savedSnapshot.tabManager);
    } else if (savedSnapshot?.conversations?.tabOrder?.length) {
      // Legacy migration: old blobs stored conversation tabs under a separate
      // `conversations` field before the unified tab refactor. Reconstruct a
      // TabManagerSnapshot so existing open conversations are preserved.
      this.tabManager.restoreSnapshot({
        tabs: savedSnapshot.conversations.tabOrder.map((id) => ({
          kind: 'conversation' as const,
          tabId: crypto.randomUUID(),
          conversationId: id,
          isPreview: false,
        })),
        activeTabId: undefined,
      });
    } else {
      // No saved snapshot — brand-new task view. Open any conversation marked as
      // the initial conversation so it appears as a tab by default.
      this.tabManager.initializeDefault();
    }

    // Create FileModelLifecycleStore after tab snapshot restore so the initial
    // model registration fires with the correct set of open file paths.
    this.editorView = new FileModelLifecycleStore(
      this.tabManager,
      resources.projectId,
      resources.workspaceId
    );

    if (savedSnapshot?.terminals) {
      this.terminalTabs.restoreSnapshot(savedSnapshot.terminals);
    }
    if (savedSnapshot?.editor) {
      this.editorView.restoreSnapshot(savedSnapshot.editor);
    }
    if (savedSnapshot?.diffView) {
      this.diffView.restoreSnapshot(savedSnapshot.diffView);
    }

    // Diff tab lifecycle: syncs DiffViewStore and auto-closes stale diff tabs.
    this.diffTabLifecycle = new DiffTabLifecycleStore(
      this.tabManager,
      resources.git,
      resources.pr,
      this.diffView
    );

    // Keep task navigation history tied to the visible task route. Explicit
    // navigate('task') pushes a task-view placeholder; once a tab is available,
    // replace that placeholder so Back lands on the concrete task tab.
    this.disposers.push(
      reaction(
        () => {
          if (!activeTaskRouteMatches(resources.projectId, resources.taskId)) return null;
          return this.tabManager.resolvedActiveTabId;
        },
        (tabId) => {
          if (!tabId) return;
          const entry = {
            kind: 'tab',
            projectId: resources.projectId,
            taskId: resources.taskId,
            tabId,
          } satisfies HistoryEntry;
          const replaced = appState.history.replaceCurrent(entry, (current) =>
            isTaskViewHistoryEntry(current, resources.projectId, resources.taskId)
          );
          if (!replaced) appState.history.push(entry);
        },
        { fireImmediately: true }
      )
    );

    makeAutoObservable(this, {
      tabManager: false,
      terminalTabs: false,
      editorView: false,
      diffView: false,
      browser: false,
      activeRenderer: computed,
    });
  }

  get sidebarTab(): SidebarTab {
    return taskSidebarPreferenceStore.sidebarTab;
  }

  get isSidebarCollapsed(): boolean {
    return taskSidebarPreferenceStore.isSidebarCollapsed;
  }

  get openSidebarGroups(): SidebarTabGroup[] {
    return taskSidebarPreferenceStore.openSidebarGroups;
  }

  get sessionPanelOpenSectionIds(): string[] {
    return [...taskSidebarPreferenceStore.sessionPanelOpenSectionIds];
  }

  isDisclosureOpen(id: string, defaultOpen: boolean): boolean {
    return taskSidebarPreferenceStore.isDisclosureOpen(id, defaultOpen);
  }

  setDisclosureOpen(id: string, open: boolean): void {
    taskSidebarPreferenceStore.setDisclosureOpen(id, open);
  }

  get activeRenderer(): RendererKind {
    const desc = this.tabManager.activeDescriptor;
    if (desc?.kind === 'overview') return 'overview';
    if (desc?.kind === 'diff') return 'diff';
    const tab = this.tabManager.activeFileEntry;
    if (!tab) return 'agents';
    switch (tab.renderer.kind) {
      case 'text':
      case 'svg-source':
        return 'monaco';
      case 'markdown':
      case 'markdown-source':
        return 'markdown';
      default:
        return 'other-file'; // image, svg, pdf, binary, too-large
    }
  }

  get snapshot(): TaskViewSnapshot {
    return {
      focusedRegion: this.focusedRegion,
      tabManager: this.tabManager.snapshot,
      browser: this.browser.snapshot,
      terminals: this.terminalTabs.snapshot,
      editor: this.editorView.snapshot,
      diffView: this.diffView.snapshot,
    };
  }

  activateLastTabOfKind(kind: 'conversation' | 'file' | 'diff'): void {
    const tabId = [...this.tabManager.tabOrder]
      .reverse()
      .find((id) => this.tabManager.entries.get(id)?.kind === kind);
    if (!tabId) return;
    const panelView = kind === 'conversation' ? 'agents' : kind === 'file' ? 'editor' : 'diff';
    focusTracker.transition({ mainPanel: panelView }, 'panel_switch');
    this.tabManager.setActiveTab(tabId);
  }

  setSidebarTab(v: SidebarTab): void {
    taskSidebarPreferenceStore.setSidebarTab(v);
    // Activating a tab from anywhere (titlebar toggle, commands, deep links)
    // surfaces its feature card in the sidebar strip.
    taskSidebarPreferenceStore.openSidebarGroup(sidebarGroupForTab(v));
  }

  openSidebarGroup(group: SidebarTabGroup): void {
    taskSidebarPreferenceStore.openSidebarGroup(group);
  }

  /**
   * Navigate the resident browser card and surface it (terminal smart URL
   * links land here so the session stays visible).
   */
  openBrowser(url?: string): void {
    if (url) this.browser.navigate(url);
    // Yield the sidebar body from any pinned tab back to the builtin panels.
    this.tabManager.setActiveSidebarTab(undefined);
    this.setSidebarTab('browser');
    this.setSidebarCollapsed(false);
  }

  closeSidebarGroup(group: SidebarTabGroup): void {
    taskSidebarPreferenceStore.closeSidebarGroup(group);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    taskSidebarPreferenceStore.setSidebarCollapsed(collapsed);
    if (collapsed) this.isSidebarMaximized = false;
  }

  setSidebarMaximized(maximized: boolean): void {
    this.isSidebarMaximized = maximized;
  }

  setSessionPanelOpenSectionIds(sectionIds: string[]): void {
    taskSidebarPreferenceStore.setSessionPanelOpenSectionIds(sectionIds);
  }

  setFocusedRegion(region: 'main' | 'bottom'): void {
    if (this.focusedRegion !== region) {
      focusTracker.transition({ focusedRegion: region }, 'region_switch');
    }
    runInAction(() => {
      this.focusedRegion = region;
    });
  }

  /** Bottom drawer chrome is a global preference shared across tasks. */
  get isTerminalDrawerOpen(): boolean {
    return taskSidebarPreferenceStore.isBottomPanelOpen;
  }

  get bottomPanelTab(): BottomPanelTab {
    return taskSidebarPreferenceStore.bottomPanelTab;
  }

  /** Mode tabs added to the drawer strip, in user order. */
  get openBottomPanelTabs(): BottomPanelTab[] {
    return taskSidebarPreferenceStore.openBottomPanelTabs;
  }

  /** The selected mode tab, or null when it isn't in the strip (empty state). */
  get activeBottomPanelTab(): BottomPanelTab | null {
    const tab = taskSidebarPreferenceStore.bottomPanelTab;
    return taskSidebarPreferenceStore.openBottomPanelTabs.includes(tab) ? tab : null;
  }

  /** Drawer spans the full window width vs. only the main column. */
  get isBottomPanelFullWidth(): boolean {
    return taskSidebarPreferenceStore.isBottomPanelFullWidth;
  }

  setBottomPanelFullWidth(fullWidth: boolean): void {
    taskSidebarPreferenceStore.setBottomPanelFullWidth(fullWidth);
  }

  setTerminalDrawerOpen(open: boolean): void {
    taskSidebarPreferenceStore.setBottomPanelOpen(open);
    if (open && this.activeBottomPanelTab === 'terminals' && this.terminalTabs.tabs.length === 0) {
      void this.terminalsMgr.createDefaultTerminal();
    }
  }

  setBottomPanelTab(tab: BottomPanelTab): void {
    taskSidebarPreferenceStore.setBottomPanelTab(tab);
    // Activating a mode from anywhere surfaces its tab in the drawer strip.
    taskSidebarPreferenceStore.openBottomPanelTab(tab);
    // Switching to terminals in an open drawer must not land on an empty pane.
    if (tab === 'terminals' && this.isTerminalDrawerOpen && this.terminalTabs.tabs.length === 0) {
      void this.terminalsMgr.createDefaultTerminal();
    }
  }

  /** Removes a mode tab from the strip; the active one falls back to the next. */
  closeBottomPanelTab(tab: BottomPanelTab): void {
    const wasActive = this.activeBottomPanelTab === tab;
    taskSidebarPreferenceStore.closeBottomPanelTab(tab);
    if (!wasActive) return;
    const next = taskSidebarPreferenceStore.openBottomPanelTabs[0];
    if (next) this.setBottomPanelTab(next);
  }

  /** Opens the terminal drawer in terminals mode and creates a new session. */
  openNewTerminal(): void {
    taskSidebarPreferenceStore.setBottomPanelOpen(true);
    taskSidebarPreferenceStore.setBottomPanelTab('terminals');
    taskSidebarPreferenceStore.openBottomPanelTab('terminals');
    void this.terminalsMgr.createDefaultTerminal();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    // Remove any tab history entries for this task so back/forward doesn't
    // navigate to a task that no longer has an active view.
    appState.history.prune((e) => e.kind === 'tab' && e.taskId === this.taskId);
    this.tabManager.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    this.diffTabLifecycle.dispose();
    this.diffView.dispose();
  }
}
