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
});
