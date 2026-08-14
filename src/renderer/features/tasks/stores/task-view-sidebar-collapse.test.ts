import { makeAutoObservable } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskViewStore } from './task-view';

const mocks = vi.hoisted(() => ({
  historyPrune: vi.fn(),
}));

vi.mock('@renderer/features/tasks/tabs/tab-manager-store', () => ({
  TabManagerStore: class MockTabManagerStore {
    sidebarTabIds: string[] = [];
    activeSidebarTabId: string | undefined;
    tabOrder: string[] = [];
    entries = new Map();
    activeDescriptor = undefined;
    resolvedActiveTabId = undefined;
    activeFileEntry = undefined;
    snapshot = { tabs: [], activeTabId: undefined };

    constructor() {
      makeAutoObservable(this);
    }

    initializeDefault() {}
    restoreSnapshot() {}
    setActiveSidebarTab(tabId: string | undefined) {
      this.activeSidebarTabId = tabId;
    }
    dispose() {}
  },
}));

vi.mock('@renderer/features/tasks/editor/stores/file-model-lifecycle-store', () => ({
  FileModelLifecycleStore: class MockFileModelLifecycleStore {
    snapshot = { expandedPaths: [] };
    dispose() {}
  },
}));

vi.mock('@renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store', () => ({
  DiffTabLifecycleStore: class MockDiffTabLifecycleStore {
    dispose() {}
  },
}));

vi.mock('@renderer/features/tasks/diff-view/stores/diff-view-store', () => ({
  DiffViewStore: class MockDiffViewStore {
    snapshot = { diffStyle: 'unified', viewMode: 'file', commitAction: null };
    dispose() {}
  },
}));

vi.mock('@renderer/features/tasks/browser/browser-store', () => ({
  TaskBrowserStore: class MockTaskBrowserStore {
    snapshot = {};
    navigate() {}
    dispose() {}
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: { currentViewId: 'home', viewParamsStore: {} },
    history: {
      replaceCurrent: vi.fn(() => false),
      push: vi.fn(),
      prune: mocks.historyPrune,
    },
  },
}));

vi.mock('@renderer/utils/focus-tracker', () => ({
  focusTracker: { transition: vi.fn() },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { error: vi.fn() },
}));

function createTaskView(): TaskViewStore {
  return new TaskViewStore({
    conversations: {} as never,
    terminals: {} as never,
    git: {} as never,
    pr: {} as never,
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
  });
}

describe('TaskViewStore empty sidebar collapse', () => {
  beforeEach(() => {
    mocks.historyPrune.mockReset();
  });

  it('keeps a manually opened empty sidebar available for adding a card', () => {
    const taskView = createTaskView();

    taskView.setSidebarCollapsed(false);

    expect(taskView.isSidebarCollapsed).toBe(false);
    taskView.dispose();
  });

  it('collapses after the last feature-card tab closes', () => {
    const taskView = createTaskView();
    taskView.openSidebarGroup('session');
    taskView.setSidebarCollapsed(false);

    taskView.closeSidebarGroup('session');

    expect(taskView.isSidebarCollapsed).toBe(true);
    taskView.dispose();
  });

  it('waits for both feature cards and pinned tabs to become empty', () => {
    const taskView = createTaskView();
    taskView.openSidebarGroup('files');
    taskView.tabManager.sidebarTabIds.push('file-1');
    taskView.setSidebarCollapsed(false);

    taskView.closeSidebarGroup('files');
    expect(taskView.isSidebarCollapsed).toBe(false);

    taskView.tabManager.sidebarTabIds.pop();
    expect(taskView.isSidebarCollapsed).toBe(true);
    taskView.dispose();
  });
});
