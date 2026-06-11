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
        sessionPanelOpenSectionIds: ['conversation'],
        disclosureOpenIds: [],
        isBottomPanelOpen: false,
      },
      { sidebarTab: 'changes', isSidebarCollapsed: true }
    );

    expect(store.sidebarTab).toBe('files');
    expect(store.isSidebarCollapsed).toBe(false);
    expect(store.sessionPanelOpenSectionIds).toEqual(['conversation']);
    expect(mocks.set).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'files',
      isSidebarCollapsed: false,
      sessionPanelOpenSectionIds: ['conversation'],
      sessionPanelUnitOrder: [
        'basic',
        'conversation',
        'transcript',
        'tasks',
        'persona',
        'memory',
        'tools',
        'mcp-servers',
        'skills',
        'agents-available',
        'statusline',
        'hooks',
        'overview',
      ],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
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
      sessionPanelOpenSectionIds: ['basic'],
      sessionPanelUnitOrder: [
        'basic',
        'conversation',
        'transcript',
        'tasks',
        'persona',
        'memory',
        'tools',
        'mcp-servers',
        'skills',
        'agents-available',
        'statusline',
        'hooks',
        'overview',
      ],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
    });
  });

  it('persists tab and open state changes to the shared key', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate(
      {
        sidebarTab: 'task',
        isSidebarCollapsed: true,
        sessionPanelOpenSectionIds: ['basic'],
        disclosureOpenIds: [],
      },
      null
    );
    vi.clearAllMocks();

    store.setSidebarTab('context');
    store.setSidebarCollapsed(false);

    expect(mocks.save).toHaveBeenNthCalledWith(1, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: true,
      sessionPanelOpenSectionIds: ['basic'],
      sessionPanelUnitOrder: [
        'basic',
        'conversation',
        'transcript',
        'tasks',
        'persona',
        'memory',
        'tools',
        'mcp-servers',
        'skills',
        'agents-available',
        'statusline',
        'hooks',
        'overview',
      ],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
    });
    expect(mocks.save).toHaveBeenNthCalledWith(2, TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'context',
      isSidebarCollapsed: false,
      sessionPanelOpenSectionIds: ['basic'],
      sessionPanelUnitOrder: [
        'basic',
        'conversation',
        'transcript',
        'tasks',
        'persona',
        'memory',
        'tools',
        'mcp-servers',
        'skills',
        'agents-available',
        'statusline',
        'hooks',
        'overview',
      ],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
    });
  });

  it('folds the legacy harness card into the session card on hydrate', () => {
    const store = new TaskSidebarPreferenceStore();

    store.hydrate(
      {
        sidebarTab: 'context',
        isSidebarCollapsed: false,
        sessionPanelOpenSectionIds: ['basic'],
        disclosureOpenIds: [],
        openSidebarGroups: ['harness', 'session', 'files'],
      },
      null
    );

    expect(store.openSidebarGroups).toEqual(['session', 'files']);
  });

  it('persists session panel accordion sections to the shared key', () => {
    const store = new TaskSidebarPreferenceStore();
    store.hydrate(
      {
        sidebarTab: 'session',
        isSidebarCollapsed: false,
        sessionPanelOpenSectionIds: ['basic'],
        disclosureOpenIds: [],
      },
      null
    );
    vi.clearAllMocks();

    store.setSessionPanelOpenSectionIds(['hooks', 'hooks']);

    expect(mocks.save).toHaveBeenCalledWith(TASK_SIDEBAR_VIEW_STATE_KEY, {
      sidebarTab: 'session',
      isSidebarCollapsed: false,
      sessionPanelOpenSectionIds: ['hooks'],
      sessionPanelUnitOrder: [
        'basic',
        'conversation',
        'transcript',
        'tasks',
        'persona',
        'memory',
        'tools',
        'mcp-servers',
        'skills',
        'agents-available',
        'statusline',
        'hooks',
        'overview',
      ],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
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
