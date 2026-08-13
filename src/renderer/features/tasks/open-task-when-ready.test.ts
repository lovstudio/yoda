import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { openTaskWhenReady } from './open-task-when-ready';
import { taskOpenTransitionStore } from './task-open-transition-store';

const mocks = vi.hoisted(() => ({
  appTabsOpenTaskScope: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  logWarn: vi.fn(),
  openProvisionedTaskTab: vi.fn(),
  prepareExplicitTaskOpen: vi.fn(),
  provisionTask: vi.fn(),
  resolveLastTaskSessionTarget: vi.fn(),
  navigation: {
    currentViewId: 'task',
    viewParamsStore: {
      task: {
        projectId: 'project-current',
        taskId: 'task-current',
      } as { projectId: string; taskId: string; tab?: TaskWindowTabTarget },
    },
  },
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openProvisionedTaskTab: mocks.openProvisionedTaskTab,
}));
vi.mock('@renderer/app/prepare-explicit-task-open', () => ({
  prepareExplicitTaskOpen: mocks.prepareExplicitTaskOpen,
}));
vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: (store: unknown) => store,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
}));
vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    appTabs: { openTaskScope: mocks.appTabsOpenTaskScope },
    history: {},
    navigation: mocks.navigation,
  },
}));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: mocks.logWarn } }));
vi.mock('./resolve-task-session-target', () => ({
  resolveLastTaskSessionTarget: mocks.resolveLastTaskSessionTarget,
}));

describe('openTaskWhenReady', () => {
  const navigate = vi.fn();
  const provisioned = { taskView: { tabManager: {} } };
  const conversationTarget = {
    kind: 'conversation' as const,
    conversationId: 'conversation-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-current',
      taskId: 'task-current',
    };
    mocks.prepareExplicitTaskOpen.mockResolvedValue(undefined);
    mocks.provisionTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({ provisionTask: mocks.provisionTask });
    mocks.getTaskStore.mockReturnValue(provisioned);
    mocks.resolveLastTaskSessionTarget.mockReturnValue(conversationTarget);
    mocks.openProvisionedTaskTab.mockResolvedValue(true);
    mocks.appTabsOpenTaskScope.mockImplementation((projectId, taskId, tab) => {
      mocks.navigation.currentViewId = 'task';
      mocks.navigation.viewParamsStore.task = { projectId, taskId, tab };
      return true;
    });
    navigate.mockImplementation((_viewId, params) => {
      mocks.navigation.currentViewId = 'task';
      mocks.navigation.viewParamsStore.task = params;
    });
  });

  it('switches a provisioned task to its remembered session in the click turn', async () => {
    let finishTarget!: (found: boolean) => void;
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishTarget = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);

    expect(mocks.resolveLastTaskSessionTarget).toHaveBeenCalledOnce();
    expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce();
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.prepareExplicitTaskOpen).not.toHaveBeenCalled();
    expect(mocks.provisionTask).not.toHaveBeenCalled();

    finishTarget(true);
    await expect(opening).resolves.toBe(true);
  });

  it('routes a cold task immediately, then commits its final session after provisioning', async () => {
    let finishProvision!: () => void;
    let finishTarget!: (found: boolean) => void;
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.provisionTask.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishProvision = resolve;
      })
    );
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishTarget = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);

    expect(navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
    await vi.waitFor(() => expect(mocks.provisionTask).toHaveBeenCalledWith('task-1'));

    finishProvision();
    await vi.waitFor(() =>
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      )
    );
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
    finishTarget(true);
    await expect(opening).resolves.toBe(true);

    expect(mocks.openProvisionedTaskTab).toHaveBeenCalledWith(
      provisioned,
      conversationTarget,
      expect.any(Object)
    );
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
  });

  it('falls back to overview when the remembered session no longer exists', async () => {
    mocks.openProvisionedTaskTab.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.openProvisionedTaskTab).toHaveBeenNthCalledWith(
      2,
      provisioned,
      { kind: 'overview' },
      expect.any(Object)
    );
    expect(mocks.appTabsOpenTaskScope).toHaveBeenLastCalledWith('project-1', 'task-1', {
      kind: 'overview',
    });
  });

  it('replaces a cold task route when its remembered session no longer exists', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.openProvisionedTaskTab.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenNthCalledWith(
      1,
      'project-1',
      'task-1',
      conversationTarget
    );
    expect(mocks.appTabsOpenTaskScope).toHaveBeenNthCalledWith(2, 'project-1', 'task-1', {
      kind: 'overview',
    });
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
  });

  it('uses overview when the task has no remembered agent session', async () => {
    mocks.resolveLastTaskSessionTarget.mockReturnValueOnce(undefined);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith('project-1', 'task-1', {
      kind: 'overview',
    });
  });

  it('keeps an explicit target instead of consulting task history', async () => {
    await expect(
      openTaskWhenReady('project-1', 'task-1', navigate, conversationTarget)
    ).resolves.toBe(true);

    expect(mocks.resolveLastTaskSessionTarget).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
  });

  it('lets only the newest cold task click commit a final target', async () => {
    let finishFirst!: () => void;
    mocks.getTaskStore
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(provisioned);
    mocks.prepareExplicitTaskOpen
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
      )
      .mockResolvedValueOnce(undefined);

    const first = openTaskWhenReady('project-1', 'task-1', navigate);
    const second = openTaskWhenReady('project-1', 'task-2', navigate);
    await expect(second).resolves.toBe(true);
    finishFirst();
    await expect(first).resolves.toBe(false);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledTimes(1);
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-2',
      conversationTarget
    );
  });

  it('keeps the stable target task route when cold preparation fails', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined);
    mocks.prepareExplicitTaskOpen.mockRejectedValueOnce(new Error('mount failed'));

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(false);

    expect(navigate).toHaveBeenCalledOnce();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });
});
