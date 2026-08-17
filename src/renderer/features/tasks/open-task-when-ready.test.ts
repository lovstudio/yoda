import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { openTaskWhenReady } from './open-task-when-ready';
import { taskOpenTransitionStore } from './task-open-transition-store';

const mocks = vi.hoisted(() => ({
  appTabsOpenTaskScope: vi.fn(),
  getArchivedConversationsForTask: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  logWarn: vi.fn(),
  openProvisionedTaskTab: vi.fn(),
  activatePreparedTarget: vi.fn(),
  markProvisionPresentationTimedOut: vi.fn(),
  prepareExplicitTaskOpen: vi.fn(),
  prepareConversationForOpen: vi.fn(),
  provisionTask: vi.fn(),
  resolveLastTaskSessionTarget: vi.fn(),
  showModal: vi.fn(),
  toast: vi.fn(),
  navigation: {
    revision: 0,
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
vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@renderer/lib/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getArchivedConversationsForTask: mocks.getArchivedConversationsForTask,
    },
  },
}));
vi.mock('@renderer/lib/modal/modal-provider', () => ({ showModal: mocks.showModal }));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: mocks.logWarn } }));
vi.mock('./resolve-task-session-target', () => ({
  resolveLastTaskSessionTarget: mocks.resolveLastTaskSessionTarget,
}));

describe('openTaskWhenReady', () => {
  const navigate = vi.fn();
  const conversationTarget = {
    kind: 'conversation' as const,
    conversationId: 'conversation-1',
  };
  const cachedPty = {
    canRevealImmediately: true,
    sessionId: 'project-1:task-1:conversation-1',
    acquireCanonicalRevealClaim: vi.fn(),
    invalidateHotReveal: vi.fn(),
  };
  const cachedSession: { pty: typeof cachedPty | null } = { pty: cachedPty };
  const provisioned = {
    taskView: { tabManager: {} },
    conversations: {
      conversations: new Map([
        [
          conversationTarget.conversationId,
          {
            data: { id: conversationTarget.conversationId },
            session: cachedSession,
          },
        ],
      ]),
      prepareConversationForOpen: mocks.prepareConversationForOpen,
    },
  };
  const preparedSelection = (found = true) => ({
    found,
    activate: () => {
      if (!found) return false;
      mocks.activatePreparedTarget();
      return true;
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    taskOpenTransitionStore.dismissFailure('project-1', 'task-1');
    taskOpenTransitionStore.dismissFailure('project-1', 'task-2');
    taskOpenTransitionStore.dismissFailure('project-2', 'task-2');
    cachedSession.pty = cachedPty;
    mocks.navigation.revision = 0;
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-current',
      taskId: 'task-current',
    };
    mocks.prepareExplicitTaskOpen.mockResolvedValue(undefined);
    mocks.getArchivedConversationsForTask.mockReset().mockResolvedValue([]);
    mocks.prepareConversationForOpen.mockResolvedValue(true);
    mocks.provisionTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      provisionTask: mocks.provisionTask,
      markProvisionPresentationTimedOut: mocks.markProvisionPresentationTimedOut,
    });
    mocks.getTaskStore.mockReturnValue(provisioned);
    mocks.resolveLastTaskSessionTarget.mockReturnValue(conversationTarget);
    mocks.openProvisionedTaskTab.mockResolvedValue(preparedSelection());
    cachedPty.canRevealImmediately = true;
    cachedPty.acquireCanonicalRevealClaim.mockResolvedValue(true);
    cachedPty.invalidateHotReveal.mockImplementation(() => {
      cachedPty.canRevealImmediately = false;
    });
    mocks.appTabsOpenTaskScope.mockImplementation((projectId, taskId, tab) => {
      mocks.navigation.revision += 1;
      mocks.navigation.currentViewId = 'task';
      mocks.navigation.viewParamsStore.task = { projectId, taskId, tab };
      return true;
    });
    navigate.mockImplementation((_viewId, params) => {
      mocks.navigation.revision += 1;
      mocks.navigation.currentViewId = 'task';
      mocks.navigation.viewParamsStore.task = params;
    });
  });

  // Archiving is an organizational state, not a runtime one: an archived task
  // opens, routes, and runs exactly like an active one. What opening must never
  // do is unarchive the task as a side effect.
  const archivedProvisioned = {
    ...provisioned,
    data: { id: 'task-1', archivedAt: '2026-08-14T10:00:00.000Z' },
  };

  it('opens an archived task through the normal path, not a transcript modal', async () => {
    mocks.getTaskStore.mockReturnValue(archivedProvisioned);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
    expect(mocks.showModal).not.toHaveBeenCalled();
    expect(mocks.getArchivedConversationsForTask).not.toHaveBeenCalled();
  });

  it('provisions a cold archived task without unarchiving it', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(archivedProvisioned);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.prepareExplicitTaskOpen).toHaveBeenCalledWith('project-1', 'task-1');
    expect(mocks.provisionTask).toHaveBeenCalledWith('task-1');
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('switches a provisioned task after its cached generation fence', async () => {
    let finishTarget!: (selection: ReturnType<typeof preparedSelection>) => void;
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<ReturnType<typeof preparedSelection>>((resolve) => {
        finishTarget = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);

    expect(mocks.resolveLastTaskSessionTarget).toHaveBeenCalledOnce();
    expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(cachedPty.acquireCanonicalRevealClaim).toHaveBeenCalledOnce());
    expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.prepareExplicitTaskOpen).not.toHaveBeenCalled();
    expect(mocks.provisionTask).not.toHaveBeenCalled();

    finishTarget(preparedSelection());
    await expect(opening).resolves.toBe(true);
    expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
  });

  it('keeps a same-task file selected while the conversation reveal claim is pending', async () => {
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'file', path: 'src/current.ts' },
    };
    let finishClaim!: (claimed: boolean) => void;
    cachedPty.acquireCanonicalRevealClaim.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishClaim = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);
    await vi.waitFor(() => expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce());

    expect(mocks.openProvisionedTaskTab).toHaveBeenCalledWith(
      provisioned,
      conversationTarget,
      expect.objectContaining({ deferSelection: true, topLevelMode: 'internal' })
    );
    expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    expect(mocks.navigation.viewParamsStore.task.tab).toEqual({
      kind: 'file',
      path: 'src/current.ts',
    });

    finishClaim(true);
    await expect(opening).resolves.toBe(true);
    expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
  });

  it('abandons a held hot claim for a target-less loader when hydration exceeds 900ms', async () => {
    vi.useFakeTimers();
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'file', path: 'src/current.ts' },
    };
    let finishHydration!: (selection: ReturnType<typeof preparedSelection>) => void;
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<ReturnType<typeof preparedSelection>>((resolve) => {
        finishHydration = resolve;
      })
    );

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.advanceTimersByTimeAsync(0);
      expect(cachedPty.acquireCanonicalRevealClaim).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(899);
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
      expect(cachedPty.invalidateHotReveal).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(mocks.navigation.viewParamsStore.task.tab).toEqual({
        kind: 'file',
        path: 'src/current.ts',
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(cachedPty.invalidateHotReveal).toHaveBeenCalledOnce();
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
      expect(navigate).toHaveBeenCalledWith('task', {
        projectId: 'project-1',
        taskId: 'task-1',
      });
      expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();

      finishHydration(preparedSelection());
      await expect(opening).resolves.toBe(true);
      expect(mocks.prepareConversationForOpen).toHaveBeenCalledWith(
        conversationTarget.conversationId,
        expect.any(Function),
        expect.any(Number),
        expect.objectContaining({
          contextId: expect.stringMatching(/^task-open-/),
          clickAtEpochMs: expect.any(Number),
        })
      );
      expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stages instead of exposing a stale hot frame when the reveal claim is rejected', async () => {
    cachedPty.acquireCanonicalRevealClaim.mockResolvedValueOnce(false);
    let finishFrame!: (ready: boolean) => void;
    mocks.prepareConversationForOpen.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishFrame = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);
    await vi.waitFor(() => expect(cachedPty.invalidateHotReveal).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledOnce();

    finishFrame(true);
    await expect(opening).resolves.toBe(true);
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
    // The staging route becomes the final route by removing its opaque overlay;
    // reveal must not create a second navigation revision or tab replay.
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledTimes(1);
  });

  it('stages instead of exposing the old frame while a replacement blocks the claim', async () => {
    cachedPty.acquireCanonicalRevealClaim.mockResolvedValueOnce(false);

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);

    await vi.waitFor(() => expect(cachedPty.invalidateHotReveal).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
    await expect(opening).resolves.toBe(true);
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledTimes(1);
    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      conversationTarget
    );
  });

  it('falls back to hidden staging when the hot generation fence does not answer', async () => {
    vi.useFakeTimers();
    try {
      cachedPty.acquireCanonicalRevealClaim.mockReturnValueOnce(
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))
      );
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);

      await vi.advanceTimersByTimeAsync(99);
      expect(mocks.prepareConversationForOpen).not.toHaveBeenCalled();
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
      await expect(opening).resolves.toBe(true);
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('captures target hydration failure while the hot generation fence is pending', async () => {
    vi.useFakeTimers();
    const failure = new Error('target hydration failed');
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => unhandledRejections.push(error);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      let finishClaim!: (claimed: boolean) => void;
      mocks.openProvisionedTaskTab.mockRejectedValueOnce(failure);
      cachedPty.acquireCanonicalRevealClaim.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          finishClaim = resolve;
        })
      );

      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.waitFor(() => expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce());
      expect(unhandledRejections).toEqual([]);
      finishClaim(false);

      await expect(opening).resolves.toBe(false);
      expect(unhandledRejections).toEqual([]);
      expect(mocks.logWarn).toHaveBeenCalledWith(
        'Failed to stage provisioned task target',
        expect.objectContaining({ error: failure })
      );
      expect(mocks.toast).toHaveBeenCalledOnce();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      vi.useRealTimers();
    }
  });

  it('cancels a superseded hot generation fence without rejecting globally', async () => {
    vi.useFakeTimers();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => unhandledRejections.push(error);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      let finishFirstClaim!: (claimed: boolean) => void;
      cachedPty.acquireCanonicalRevealClaim.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          finishFirstClaim = resolve;
        })
      );

      const firstOpening = openTaskWhenReady('project-1', 'task-1', navigate);
      const secondOpening = openTaskWhenReady('project-2', 'task-2', navigate);
      await expect(secondOpening).resolves.toBe(true);
      finishFirstClaim(false);

      await expect(firstOpening).resolves.toBe(false);
      expect(unhandledRejections).toEqual([]);
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      vi.useRealTimers();
    }
  });

  it('stages a cold task immediately once provisioning and target hydration resolve', async () => {
    vi.useFakeTimers();
    let finishProvision!: () => void;
    let finishTarget!: (selection: ReturnType<typeof preparedSelection>) => void;
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.provisionTask.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishProvision = resolve;
      })
    );
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<ReturnType<typeof preparedSelection>>((resolve) => {
        finishTarget = resolve;
      })
    );

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);

      expect(navigate).not.toHaveBeenCalled();
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
      await vi.waitFor(() => expect(mocks.provisionTask).toHaveBeenCalledWith('task-1'));

      finishProvision();
      await vi.waitFor(() => expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce());
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
      finishTarget(preparedSelection());
      await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
      expect(navigate).not.toHaveBeenCalled();

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
    } finally {
      vi.useRealTimers();
    }
  });

  it('stages a provisioned conversation whose frontend terminal was evicted without waiting 900ms', async () => {
    vi.useFakeTimers();
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    const startedAt = performance.now();

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);

      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
      expect(performance.now() - startedAt).toBeLessThan(900);
      await expect(opening).resolves.toBe(true);
      expect(mocks.prepareConversationForOpen).toHaveBeenCalledWith(
        conversationTarget.conversationId,
        expect.any(Function),
        expect.any(Number),
        expect.objectContaining({
          contextId: expect.stringMatching(/^task-open-/),
          clickAtEpochMs: expect.any(Number),
        })
      );
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      evictedConversation.session.pty = cachedPty;
      vi.useRealTimers();
    }
  });

  it('shows one stable destination loader immediately while a resolved frame is staged', async () => {
    vi.useFakeTimers();
    try {
      const evictedConversation = provisioned.conversations.conversations.get(
        conversationTarget.conversationId
      );
      if (!evictedConversation) throw new Error('missing conversation fixture');
      evictedConversation.session.pty = null;
      let finishFrame!: (ready: boolean) => void;
      mocks.prepareConversationForOpen.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          finishFrame = resolve;
        })
      );

      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.waitFor(() => expect(mocks.prepareConversationForOpen).toHaveBeenCalledOnce());
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
      expect(navigate).not.toHaveBeenCalled();

      finishFrame(true);
      await expect(opening).resolves.toBe(true);
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
      evictedConversation.session.pty = cachedPty;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a target-less provisioned loader when hydration is still pending at 900ms', async () => {
    vi.useFakeTimers();
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'file', path: 'src/current.ts' },
    };
    let finishHydration!: (selection: ReturnType<typeof preparedSelection>) => void;
    mocks.openProvisionedTaskTab.mockReturnValueOnce(
      new Promise<ReturnType<typeof preparedSelection>>((resolve) => {
        finishHydration = resolve;
      })
    );

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.advanceTimersByTimeAsync(899);

      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
      expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(true);
      expect(navigate).toHaveBeenCalledWith('task', {
        projectId: 'project-1',
        taskId: 'task-1',
      });
      expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();

      finishHydration(preparedSelection());
      await expect(opening).resolves.toBe(true);
      expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    } finally {
      evictedConversation.session.pty = cachedPty;
      vi.useRealTimers();
    }
  });

  it('does not create a provisioned transition when opening is cancelled before 900ms', async () => {
    vi.useFakeTimers();
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    mocks.openProvisionedTaskTab.mockReturnValueOnce(new Promise(() => {}));

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.advanceTimersByTimeAsync(400);
      mocks.navigation.revision += 1;
      mocks.navigation.currentViewId = 'settings';
      await vi.advanceTimersByTimeAsync(25);

      await expect(opening).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
      expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
    } finally {
      evictedConversation.session.pty = cachedPty;
      vi.useRealTimers();
    }
  });

  it('keeps a target-less loader when provisioning becomes ready before history resolves', async () => {
    vi.useFakeTimers();
    try {
      let finishPreparation!: () => void;
      mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
      mocks.prepareExplicitTaskOpen.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        })
      );

      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.advanceTimersByTimeAsync(900);

      expect(navigate).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledWith('task', {
        projectId: 'project-1',
        taskId: 'task-1',
      });
      expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
      expect(mocks.resolveLastTaskSessionTarget).not.toHaveBeenCalled();

      finishPreparation();
      await vi.advanceTimersByTimeAsync(1);
      await expect(opening).resolves.toBe(true);

      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledOnce();
      expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledWith(
        'project-1',
        'task-1',
        conversationTarget
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the cold-task Logo at the hard deadline without cancelling its provision RPC', async () => {
    vi.useFakeTimers();
    let finishProvision!: () => void;
    let provisionSettled = false;
    const pendingProvision = new Promise<void>((resolve) => {
      finishProvision = resolve;
    }).then(() => {
      provisionSettled = true;
    });
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.provisionTask.mockReturnValueOnce(pendingProvision);

    try {
      const opening = openTaskWhenReady('project-1', 'task-1', navigate);
      await vi.waitFor(() => expect(mocks.provisionTask).toHaveBeenCalledWith('task-1'));

      await vi.advanceTimersByTimeAsync(30_000);

      await expect(opening).resolves.toBe(false);
      expect(mocks.markProvisionPresentationTimedOut).toHaveBeenCalledWith(
        'task-1',
        pendingProvision,
        30_000
      );
      expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
      expect(provisionSettled).toBe(false);

      finishProvision();
      await vi.waitFor(() => expect(provisionSettled).toBe(true));
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands a provisioned canonical-frame timeout to the mounted session retry loop', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    mocks.prepareConversationForOpen.mockResolvedValueOnce(false);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledOnce();
    expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    expect(taskOpenTransitionStore.hasFailed('project-1', 'task-1')).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
    const stagingBudget = mocks.prepareConversationForOpen.mock.calls[0]?.[2];
    expect(stagingBudget).toBeGreaterThan(0);
    expect(stagingBudget).toBeLessThanOrEqual(1_500);
    expect(logSpy).toHaveBeenCalledWith(
      '[DEBUG][task-open] canonical-frame-deferred:',
      expect.objectContaining({ target: 'conversation' })
    );
    logSpy.mockRestore();
    evictedConversation.session.pty = cachedPty;
  });

  it('commits a read-only conversation when another Codex window owns its writer', async () => {
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    mocks.prepareConversationForOpen.mockResolvedValueOnce('external-writer');

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
    expect(taskOpenTransitionStore.hasFailed('project-1', 'task-1')).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
    evictedConversation.session.pty = cachedPty;
  });

  it('hands a cold canonical-frame timeout to the mounted session retry loop', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.prepareConversationForOpen.mockResolvedValueOnce(false);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.appTabsOpenTaskScope).toHaveBeenCalledOnce();
    expect(mocks.activatePreparedTarget).toHaveBeenCalledOnce();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
    expect(taskOpenTransitionStore.hasFailed('project-1', 'task-1')).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  // A task IS its session, so there is no page to fall back TO: the route
  // lands on the task itself and the view renders its own session surface.
  it('routes to the task itself when the remembered session no longer exists', async () => {
    mocks.openProvisionedTaskTab.mockResolvedValueOnce(preparedSelection(false));

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(mocks.openProvisionedTaskTab).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenLastCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
  });

  it('replaces a cold task route when its remembered session no longer exists', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined).mockReturnValue(provisioned);
    mocks.openProvisionedTaskTab.mockResolvedValueOnce(preparedSelection(false));

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(navigate).toHaveBeenLastCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(taskOpenTransitionStore.isPending('project-1', 'task-1')).toBe(false);
  });

  it('routes to the task itself when it has no remembered agent session', async () => {
    mocks.resolveLastTaskSessionTarget.mockReturnValueOnce(undefined);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(true);

    expect(navigate).toHaveBeenLastCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.openProvisionedTaskTab).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
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

  it('does not let a cold open regain its lease after navigation leaves and returns', async () => {
    let finishPreparation!: () => void;
    mocks.getTaskStore.mockReturnValueOnce(undefined);
    mocks.prepareExplicitTaskOpen.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPreparation = resolve;
      })
    );

    const opening = openTaskWhenReady('project-1', 'task-1', navigate);

    mocks.navigation.revision += 1;
    mocks.navigation.currentViewId = 'settings';
    mocks.navigation.revision += 1;
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore.task = {
      projectId: 'project-current',
      taskId: 'task-current',
    };
    finishPreparation();

    await expect(opening).resolves.toBe(false);
    expect(mocks.provisionTask).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
  });

  it('shows copyable diagnostics when staging a provisioned target throws', async () => {
    const evictedConversation = provisioned.conversations.conversations.get(
      conversationTarget.conversationId
    );
    if (!evictedConversation) throw new Error('missing conversation fixture');
    evictedConversation.session.pty = null;
    const failure = new Error('snapshot failed');
    mocks.openProvisionedTaskTab.mockRejectedValueOnce(failure);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(false);

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.conversations.startingErrorTitle',
      description: 'tasks.conversations.startingErrorDescription',
      variant: 'destructive',
      debugInfo: {
        stage: 'stage-provisioned-target',
        projectId: 'project-1',
        taskId: 'task-1',
        target: conversationTarget,
        error: failure,
      },
    });
  });

  it('keeps the source route and shows diagnostics when hot target hydration throws', async () => {
    const failure = new Error('conversation lookup failed');
    mocks.openProvisionedTaskTab.mockRejectedValueOnce(failure);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(false);

    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(mocks.activatePreparedTarget).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.conversations.startingErrorTitle',
      description: 'tasks.conversations.startingErrorDescription',
      variant: 'destructive',
      debugInfo: {
        stage: 'open-provisioned-target',
        projectId: 'project-1',
        taskId: 'task-1',
        target: conversationTarget,
        error: failure,
      },
    });
  });

  it('keeps the stable target task route when cold preparation fails', async () => {
    mocks.getTaskStore.mockReturnValueOnce(undefined);
    const failure = new Error('mount failed');
    mocks.prepareExplicitTaskOpen.mockRejectedValueOnce(failure);

    await expect(openTaskWhenReady('project-1', 'task-1', navigate)).resolves.toBe(false);

    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.appTabsOpenTaskScope).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.conversations.startingErrorTitle',
      description: 'tasks.conversations.startingErrorDescription',
      variant: 'destructive',
      debugInfo: {
        stage: 'prepare-cold-task',
        projectId: 'project-1',
        taskId: 'task-1',
        target: null,
        error: failure,
      },
    });
  });
});
