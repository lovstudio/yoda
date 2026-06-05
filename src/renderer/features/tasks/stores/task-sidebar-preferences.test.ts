import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TASK_SIDEBAR_VIEW_STATE_KEY,
  TaskSidebarPreferenceStore,
} from './task-sidebar-preferences';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    viewState: {
      save: mocks.save,
    },
  },
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    set: mocks.set,
  },
}));

describe('TaskSidebarPreferenceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates from the shared snapshot before legacy task state', () => {
    const store = new TaskSidebarPreferenceStore();

    store.hydrate(
      { sidebarTab: 'files', isSidebarCollapsed: false },
      { sidebarTab: 'changes', isSidebarCollapsed: true }
    );

    expect(store.sidebarTab).toBe('files');
    expect(store.isSidebarCollapsed).toBe(false);
    expect(mocks.set).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'files',
      isSidebarCollapsed: false,
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('migrates legacy task sidebar state when no shared snapshot exists', () => {
    const store = new TaskSidebarPreferenceStore();

    store.hydrate(null, { sidebarTab: 'changes', isSidebarCollapsed: false });

    expect(store.sidebarTab).toBe('changes');
    expect(store.isSidebarCollapsed).toBe(false);
    expect(mocks.save).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'changes',
      isSidebarCollapsed: false,
    });
  });

  it('persists tab and open state changes to the shared key', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate({ sidebarTab: 'task', isSidebarCollapsed: true }, null);
    vi.clearAllMocks();

    store.setSidebarTab('context');
    store.setSidebarCollapsed(false);

    expect(mocks.save).toHaveBeenNthCalledWith(1, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: true,
    });
    expect(mocks.save).toHaveBeenNthCalledWith(2, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
    });
  });
});
