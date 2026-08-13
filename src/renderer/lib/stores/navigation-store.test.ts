import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationStore } from './navigation-store';

const mocks = vi.hoisted(() => ({
  closeModal: vi.fn(),
  markTaskSeen: vi.fn(),
  pushNavigation: vi.fn(),
  recordProjectActivity: vi.fn(),
}));

vi.mock('./app-state', () => ({
  appState: {
    agentRuntime: {
      markTaskSeen: mocks.markTaskSeen,
    },
    history: {
      pushNavigation: mocks.pushNavigation,
    },
    sidebar: {
      recordProjectActivity: mocks.recordProjectActivity,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-store', () => ({
  modalStore: {
    closeModal: mocks.closeModal,
  },
}));

vi.mock('@renderer/utils/focus-tracker', () => ({
  focusTracker: {
    transition: vi.fn(() => null),
  },
}));

vi.mock('@renderer/utils/telemetryClient', () => ({
  captureTelemetry: vi.fn(),
}));

describe('NavigationStore navigation side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat opening a project as recent activity', () => {
    const store = new NavigationStore();

    store.navigate('project', { projectId: 'project-1' });

    expect(mocks.recordProjectActivity).not.toHaveBeenCalled();
  });

  it('marks an opened task as seen without changing project activity', () => {
    const store = new NavigationStore();

    store.navigate('task', { projectId: 'project-1', taskId: 'task-1' });

    expect(mocks.recordProjectActivity).not.toHaveBeenCalled();
    expect(mocks.markTaskSeen).toHaveBeenCalledWith('project-1', 'task-1');
  });

  it('advances its revision once for each navigation intent', () => {
    const store = new NavigationStore();

    expect(store.revision).toBe(0);

    store.navigate('project', { projectId: 'project-1' });
    expect(store.revision).toBe(1);

    // Re-selecting the same route is still an external navigation intent and
    // must invalidate an older async navigation lease.
    store.navigate('project', { projectId: 'project-1' });
    expect(store.revision).toBe(2);

    // History and tab activation deliberately bypass navigate().
    store._applyNavigation('home');
    expect(store.revision).toBe(3);
  });

  it('advances its revision when routed view params are updated', () => {
    const store = new NavigationStore();

    store.updateViewParams('home', { projectId: 'project-1' });

    expect(store.revision).toBe(1);
    expect(store.viewParamsStore.home).toEqual({ projectId: 'project-1' });
  });
});

describe('NavigationStore persisted route migration', () => {
  it('restores a Marketplace app route under Library', () => {
    const store = new NavigationStore();

    store.restoreSnapshot({
      currentViewId: 'marketplace',
      viewParams: {
        marketplace: { section: 'apps', appId: 'app-1' },
      },
    });

    expect(store.currentViewId).toBe('library');
    expect(store.viewParamsStore.library).toEqual({
      section: 'apps',
      appId: 'app-1',
    });
    expect(store.viewParamsStore.marketplace).toBeUndefined();
  });

  it('keeps legacy Library aliases under Library sections', () => {
    const store = new NavigationStore();

    store.restoreSnapshot({
      currentViewId: 'library',
      viewParams: {
        library: { section: 'marketplace' },
      },
    });

    expect(store.currentViewId).toBe('library');
    expect(store.viewParamsStore.library).toEqual({ section: 'extensions' });
  });

  it('advances its runtime revision once when restoring navigation state', () => {
    const store = new NavigationStore();

    store.restoreSnapshot({});
    expect(store.revision).toBe(0);

    store.restoreSnapshot({
      currentViewId: 'settings',
      viewParams: { settings: { section: 'general' } },
    });

    expect(store.revision).toBe(1);
  });
});
