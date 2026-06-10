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
      {
        sidebarTab: 'files',
        isSidebarCollapsed: false,
        contextPanelOpenSectionIds: ['tools', 'injected-context'],
        sessionPanelOpenSectionIds: ['context'],
        disclosureOpenIds: [],
      },
      { sidebarTab: 'changes', isSidebarCollapsed: true }
    );

    expect(store.sidebarTab).toBe('files');
    expect(store.isSidebarCollapsed).toBe(false);
    expect(store.contextPanelOpenSectionIds).toEqual(['tools', 'injected-context']);
    expect(store.sessionPanelOpenSectionIds).toEqual(['context']);
    expect(mocks.set).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'files',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: ['tools', 'injected-context'],
      sessionPanelOpenSectionIds: ['context'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
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
      contextPanelOpenSectionIds: ['llm-context', 'memory'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
  });

  it('persists tab and open state changes to the shared key', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate(
      {
        sidebarTab: 'task',
        isSidebarCollapsed: true,
        contextPanelOpenSectionIds: ['session-prompts'],
      },
      null
    );
    vi.clearAllMocks();

    store.setSidebarTab('context');
    store.setSidebarCollapsed(false);

    expect(mocks.save).toHaveBeenNthCalledWith(1, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: true,
      contextPanelOpenSectionIds: ['session-prompts'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
    expect(mocks.save).toHaveBeenNthCalledWith(2, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: ['session-prompts'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
  });

  it('hydrates the session info tab from the shared snapshot', () => {
    const store = new TaskSidebarPreferenceStore();

    store.hydrate(
      {
        sidebarTab: 'session',
        isSidebarCollapsed: false,
        contextPanelOpenSectionIds: [],
      },
      null
    );

    expect(store.sidebarTab).toBe('session');
    expect(store.isSidebarCollapsed).toBe(false);
    expect(mocks.set).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'session',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: [],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
  });

  it('persists context panel accordion sections to the shared key', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate(
      {
        sidebarTab: 'context',
        isSidebarCollapsed: false,
        contextPanelOpenSectionIds: ['tools'],
      },
      null
    );
    vi.clearAllMocks();

    store.setContextPanelOpenSectionIds(['tools', 'tools', 'skills']);
    store.setContextPanelSectionOpen('session-prompts', true);
    store.setContextPanelSectionOpen('tools', false);

    expect(mocks.save).toHaveBeenNthCalledWith(1, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: ['tools', 'skills'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
    expect(mocks.save).toHaveBeenNthCalledWith(2, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: ['tools', 'skills', 'session-prompts'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
    expect(mocks.save).toHaveBeenNthCalledWith(3, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
      contextPanelOpenSectionIds: ['skills', 'session-prompts'],
      sessionPanelOpenSectionIds: ['basic'],
      disclosureOpenIds: [],
      openSidebarGroups: [],
    });
  });

  it('persists ad-hoc disclosure open state, honoring per-id defaults', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate({ disclosureOpenIds: ['+a', '-b'] }, null);
    vi.clearAllMocks();

    // Remembered values win over the supplied default.
    expect(store.isDisclosureOpen('a', false)).toBe(true);
    expect(store.isDisclosureOpen('b', true)).toBe(false);
    // Unknown id falls back to its default.
    expect(store.isDisclosureOpen('c', true)).toBe(true);
    expect(store.isDisclosureOpen('c', false)).toBe(false);

    // Setting an explicit closed survives even when default is open.
    store.setDisclosureOpen('c', false);
    expect(store.isDisclosureOpen('c', true)).toBe(false);
    expect(store.disclosureOpenIds).toEqual(['+a', '-b', '-c']);

    // Re-setting the same id replaces, never duplicates.
    store.setDisclosureOpen('a', false);
    expect(store.disclosureOpenIds).toEqual(['-b', '-c', '-a']);
    expect(store.isDisclosureOpen('a', true)).toBe(false);

    expect(mocks.save).toHaveBeenLastCalledWith(
      TASK_SIDEBAR_VIEW_STATE_KEY,
      expect.objectContaining({ disclosureOpenIds: ['-b', '-c', '-a'] })
    );
  });
});
