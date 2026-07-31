import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openNewTask, openNewTaskFromPreference } from './open-new-task';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getQueryData: vi.fn(),
  navigate: vi.fn(),
  showModal: vi.fn(),
  updateViewParams: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: mocks.getSettings,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/query-client', () => ({
  queryClient: {
    getQueryData: mocks.getQueryData,
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      navigate: mocks.navigate,
      updateViewParams: mocks.updateViewParams,
    },
  },
}));

describe('openNewTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQueryData.mockReturnValue(undefined);
  });

  it('opens Home with the current project when Home is preferred', () => {
    openNewTask('home', 'project-1');

    expect(mocks.navigate).toHaveBeenCalledWith('home', { projectId: 'project-1' });
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('opens the composer-only modal and seeds its project context', () => {
    openNewTask('modal', 'project-1');

    expect(mocks.updateViewParams).toHaveBeenCalledWith('home', { projectId: 'project-1' });
    expect(mocks.showModal).toHaveBeenCalledWith('newTaskModal', {});
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('uses the persisted preference', async () => {
    mocks.getSettings.mockResolvedValue({ newTaskOpenMode: 'modal' });

    await openNewTaskFromPreference();

    expect(mocks.getSettings).toHaveBeenCalledWith('interface');
    expect(mocks.showModal).toHaveBeenCalledWith('newTaskModal', {});
  });

  it('uses an optimistic preference change immediately', async () => {
    mocks.getQueryData.mockReturnValue({
      value: { newTaskOpenMode: 'modal' },
    });

    await openNewTaskFromPreference();

    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.showModal).toHaveBeenCalledWith('newTaskModal', {});
  });

  it('falls back to Home when settings are temporarily unavailable', async () => {
    mocks.getSettings.mockRejectedValue(new Error('settings unavailable'));

    await openNewTaskFromPreference('project-1');

    expect(mocks.navigate).toHaveBeenCalledWith('home', { projectId: 'project-1' });
  });
});
