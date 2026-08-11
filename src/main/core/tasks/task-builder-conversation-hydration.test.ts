import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  cancelConversationHydrationBarrier,
  cancelConversationHydrationBarriersForTask,
  getConversationHydrationBarrier,
} from '@main/core/conversations/conversation-hydration-barrier';
import type { ConversationProvider } from '@main/core/conversations/types';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import {
  CONVERSATION_HYDRATION_CONCURRENCY,
  CONVERSATION_TMUX_MARKER_CACHE_TTL_MS,
  discoverLiveTmuxSessionIds,
  hydratePersistedConversations,
} from './task-builder';

const mocks = vi.hoisted(() => ({
  clearPendingInitialPrompt: vi.fn(),
  disposeExecutionContext: vi.fn(),
  getActiveConversation: vi.fn(),
  listTmuxSessionMarkers: vi.fn(),
}));

vi.mock('@main/core/conversations/pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: mocks.clearPendingInitialPrompt,
}));

vi.mock('@main/core/conversations/get-active-conversation', () => ({
  getActiveConversation: mocks.getActiveConversation,
}));

vi.mock('@main/core/workspaces/workspace-factory', () => ({
  buildTaskProviders: vi.fn(),
  createWorkspaceFactory: vi.fn(),
  resolveTaskEnv: vi.fn(),
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: class {
    dispose = mocks.disposeExecutionContext;
  },
}));

vi.mock('@main/core/execution-context/ssh-execution-context', () => ({
  SshExecutionContext: class {
    dispose = mocks.disposeExecutionContext;
  },
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  decodeTmuxSessionName: (sessionName: string) => sessionName,
  listTmuxSessionMarkers: mocks.listTmuxSessionMarkers,
}));

vi.mock('@main/db/client', () => ({ db: {}, sqlite: {} }));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function conversation(id: string, pending = false): Conversation {
  return {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: id,
    lastInteractedAt: null,
    isInitialConversation: false,
    ...(pending ? { pendingInitialPrompt: { prompt: `Prompt for ${id}` } } : {}),
  };
}

function providerWith(
  startSession: ConversationProvider['startSession'],
  waitsForCodexBinding = true
): ConversationProvider {
  return {
    startSession,
    waitsForInitialPromptSessionBinding: (runtimeId) =>
      waitsForCodexBinding && runtimeId === 'codex',
  } as ConversationProvider;
}

describe('persisted conversation hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearPendingInitialPrompt.mockResolvedValue(undefined);
    mocks.getActiveConversation.mockImplementation(async (item: Conversation) => item);
  });

  it('revalidates persisted ownership before starting a captured conversation', async () => {
    const pending = conversation('deleted-before-hydration', true);
    const startSession = vi.fn().mockResolvedValue(undefined);
    mocks.getActiveConversation.mockResolvedValueOnce(undefined);

    await hydratePersistedConversations(
      providerWith(startSession),
      [pending],
      'test',
      Promise.resolve(new Set())
    );

    expect(startSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('starts pending prompts and reconnects only conversations with a live canonical tmux id', async () => {
    const pending = conversation('pending', true);
    const live = conversation('live');
    const hibernated = conversation('hibernated');
    const startSession = vi.fn().mockResolvedValue(undefined);

    await hydratePersistedConversations(
      providerWith(startSession),
      [pending, live, hibernated],
      'test',
      Promise.resolve(
        new Set([makePtySessionId(live.projectId, live.taskId, live.id), 'non-canonical-id'])
      )
    );

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(startSession.mock.calls.map(([item]) => item.id)).toEqual(
      expect.arrayContaining([pending.id, live.id])
    );
    expect(startSession.mock.calls.map(([item]) => item.id)).not.toContain(hibernated.id);
    expect(startSession).toHaveBeenCalledWith(
      live,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      { model: undefined, reasoningEffort: undefined },
      { reattachExistingTmuxSession: true }
    );
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('acknowledges non-Codex pending prompts when provider startup resolves', async () => {
    const pending = { ...conversation('pending', true), runtimeId: 'claude' as const };
    const startSession = vi.fn().mockResolvedValue(undefined);

    await hydratePersistedConversations(
      providerWith(startSession),
      [pending],
      'test',
      Promise.resolve(new Set())
    );

    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledOnce();
    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledWith(pending.id, {
      projectId: pending.projectId,
      taskId: pending.taskId,
      deliveryToken: undefined,
    });
  });

  it('acknowledges an SSH Codex prompt when remote startup resolves', async () => {
    const pending = conversation('pending', true);
    const startSession = vi.fn().mockResolvedValue(undefined);

    await hydratePersistedConversations(
      providerWith(startSession, false),
      [pending],
      'test',
      Promise.resolve(new Set())
    );

    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledOnce();
    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledWith(pending.id, {
      projectId: pending.projectId,
      taskId: pending.taskId,
      deliveryToken: undefined,
    });
  });

  it('does not delay a pending first prompt on the tmux marker lookup', async () => {
    let resolveMarkers!: (sessionIds: ReadonlySet<string>) => void;
    const markerLookup = new Promise<ReadonlySet<string>>((resolve) => {
      resolveMarkers = resolve;
    });
    const pending = conversation('pending', true);
    const startSession = vi.fn().mockResolvedValue(undefined);

    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [pending],
      'test',
      markerLookup
    );
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());

    resolveMarkers(new Set());
    await hydration;
  });

  it('reattaches an attempted pending prompt when its canonical tmux pane survived', async () => {
    let resolveMarkers!: (sessionIds: ReadonlySet<string>) => void;
    const markerLookup = new Promise<ReadonlySet<string>>((resolve) => {
      resolveMarkers = resolve;
    });
    const attempted = {
      ...conversation('attempted', true),
      pendingInitialPrompt: {
        prompt: 'Prompt for attempted',
        attemptStartedAtMs: 5_000,
      },
    };
    const startSession = vi.fn().mockResolvedValue(undefined);

    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      markerLookup
    );
    await Promise.resolve();
    expect(startSession).not.toHaveBeenCalled();

    resolveMarkers(
      new Set([makePtySessionId(attempted.projectId, attempted.taskId, attempted.id)])
    );
    await hydration;

    expect(startSession).toHaveBeenCalledOnce();
    expect(startSession.mock.calls[0]?.[7]).toEqual({ reattachExistingTmuxSession: true });
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('does not revive marker-delayed conversations after their task detaches', async () => {
    let resolveMarkers!: (sessionIds: ReadonlySet<string>) => void;
    const markerLookup = new Promise<ReadonlySet<string>>((resolve) => {
      resolveMarkers = resolve;
    });
    const attempted = {
      ...conversation('detached-before-marker', true),
      pendingInitialPrompt: { prompt: 'Keep pending', attemptStartedAtMs: 5_000 },
    };
    const startSession = vi.fn().mockResolvedValue(undefined);
    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      markerLookup
    );

    cancelConversationHydrationBarriersForTask(attempted.projectId, attempted.taskId);
    resolveMarkers(new Set());
    await hydration;

    expect(startSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('retries an attempted pending prompt when no canonical tmux pane remains', async () => {
    const attempted = {
      ...conversation('attempted', true),
      pendingInitialPrompt: {
        prompt: 'Prompt for attempted',
        attemptStartedAtMs: 5_000,
      },
    };
    const startSession = vi.fn().mockResolvedValue(undefined);

    await hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      Promise.resolve(new Set())
    );

    expect(startSession).toHaveBeenCalledOnce();
    expect(startSession.mock.calls[0]?.[7]).toBeUndefined();
  });

  it('keeps attempted-prompt barriers independent per conversation', async () => {
    const first = {
      ...conversation('attempted-a', true),
      pendingInitialPrompt: { prompt: 'A', attemptStartedAtMs: 5_000 },
    };
    const second = {
      ...conversation('attempted-b', true),
      pendingInitialPrompt: { prompt: 'B', attemptStartedAtMs: 5_000 },
    };
    let finishSecond!: () => void;
    const startSession = vi.fn(async (item: Conversation) => {
      if (item.id === second.id) {
        await new Promise<void>((resolve) => {
          finishSecond = resolve;
        });
      }
    });

    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [first, second],
      'test',
      Promise.resolve(new Set())
    );
    const firstBarrier = getConversationHydrationBarrier(first.projectId, first.taskId, first.id);
    const secondBarrier = getConversationHydrationBarrier(
      second.projectId,
      second.taskId,
      second.id
    );

    await expect(firstBarrier).resolves.toBeUndefined();
    let secondSettled = false;
    void secondBarrier?.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    finishSecond();
    await hydration;
  });

  it('retries once without attach-only mode when strict tmux reattach misses', async () => {
    const attempted = {
      ...conversation('reattach-miss', true),
      pendingInitialPrompt: { prompt: 'Retry me', attemptStartedAtMs: 5_000 },
    };
    const startSession = vi
      .fn()
      .mockRejectedValueOnce(new TmuxReattachMissError())
      .mockResolvedValueOnce(undefined);

    await hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      Promise.resolve(
        new Set([makePtySessionId(attempted.projectId, attempted.taskId, attempted.id)])
      )
    );

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(startSession.mock.calls[0]?.[7]).toEqual({ reattachExistingTmuxSession: true });
    expect(startSession.mock.calls[1]?.[7]).toBeUndefined();
  });

  it('does not start or clear a prompt whose hydration was cancelled while markers loaded', async () => {
    let finishMarkers!: (sessionIds: ReadonlySet<string>) => void;
    const markerLookup = new Promise<ReadonlySet<string>>((resolve) => {
      finishMarkers = resolve;
    });
    const attempted = {
      ...conversation('archived-during-hydration', true),
      pendingInitialPrompt: { prompt: 'Do not revive', attemptStartedAtMs: 5_000 },
    };
    const startSession = vi.fn().mockResolvedValue(undefined);
    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      markerLookup
    );

    cancelConversationHydrationBarrier(attempted.projectId, attempted.taskId, attempted.id);
    finishMarkers(new Set());
    await hydration;

    expect(startSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('does not retry or clear when cancellation lands during strict reattach', async () => {
    const attempted = {
      ...conversation('deleted-during-reattach', true),
      pendingInitialPrompt: { prompt: 'Do not retry', attemptStartedAtMs: 5_000 },
    };
    let rejectAttach!: (error: Error) => void;
    const startSession = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAttach = reject;
        })
    );
    const hydration = hydratePersistedConversations(
      providerWith(startSession),
      [attempted],
      'test',
      Promise.resolve(
        new Set([makePtySessionId(attempted.projectId, attempted.taskId, attempted.id)])
      )
    );
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());

    cancelConversationHydrationBarrier(attempted.projectId, attempted.taskId, attempted.id);
    rejectAttach(new TmuxReattachMissError());
    await hydration;

    expect(startSession).toHaveBeenCalledOnce();
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('bounds Agent startup work across concurrent task hydration passes', async () => {
    let active = 0;
    let maxActive = 0;
    const startSession = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    const conversations = Array.from(
      { length: CONVERSATION_HYDRATION_CONCURRENCY * 3 + 1 },
      (_, index) => conversation(`pending-${index}`, true)
    );

    await Promise.all([
      hydratePersistedConversations(
        providerWith(startSession),
        conversations.slice(0, 7),
        'task-1'
      ),
      hydratePersistedConversations(providerWith(startSession), conversations.slice(7), 'task-2'),
    ]);

    expect(startSession).toHaveBeenCalledTimes(conversations.length);
    expect(maxActive).toBe(CONVERSATION_HYDRATION_CONCURRENCY);
  });

  it('shares a short-lived tmux marker sample across tasks on the same host', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      let resolveMarkers!: (markers: Array<{ sessionName: string; cwd: string }>) => void;
      mocks.listTmuxSessionMarkers.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMarkers = resolve;
          })
      );

      const first = discoverLiveTmuxSessionIds({ kind: 'local' });
      const second = discoverLiveTmuxSessionIds({ kind: 'local' });
      expect(mocks.listTmuxSessionMarkers).toHaveBeenCalledOnce();

      resolveMarkers([{ sessionName: 'session-1', cwd: '/repo' }]);
      await expect(Promise.all([first, second])).resolves.toEqual([
        new Set(['session-1']),
        new Set(['session-1']),
      ]);
      await expect(discoverLiveTmuxSessionIds({ kind: 'local' })).resolves.toEqual(
        new Set(['session-1'])
      );
      expect(mocks.listTmuxSessionMarkers).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(CONVERSATION_TMUX_MARKER_CACHE_TTL_MS + 1);
      mocks.listTmuxSessionMarkers.mockResolvedValueOnce([
        { sessionName: 'session-2', cwd: '/repo' },
      ]);
      await expect(discoverLiveTmuxSessionIds({ kind: 'local' })).resolves.toEqual(
        new Set(['session-2'])
      );
      expect(mocks.listTmuxSessionMarkers).toHaveBeenCalledTimes(2);
      expect(mocks.disposeExecutionContext).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
