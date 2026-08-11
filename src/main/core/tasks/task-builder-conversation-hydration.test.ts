import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import type { ConversationProvider } from '@main/core/conversations/types';
import {
  CONVERSATION_HYDRATION_CONCURRENCY,
  CONVERSATION_TMUX_MARKER_CACHE_TTL_MS,
  discoverLiveTmuxSessionIds,
  hydratePersistedConversations,
} from './task-builder';

const mocks = vi.hoisted(() => ({
  clearPendingInitialPrompt: vi.fn(),
  disposeExecutionContext: vi.fn(),
  listTmuxSessionMarkers: vi.fn(),
}));

vi.mock('@main/core/conversations/pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: mocks.clearPendingInitialPrompt,
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

function providerWith(startSession: ConversationProvider['startSession']): ConversationProvider {
  return { startSession } as ConversationProvider;
}

describe('persisted conversation hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearPendingInitialPrompt.mockResolvedValue(undefined);
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
    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledOnce();
    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledWith(pending.id);
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
