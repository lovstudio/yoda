import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import {
  cancelConversationHydrationBarrier,
  registerConversationHydrationBarrier,
} from './conversation-hydration-barrier';
import { resumeConversation } from './resumeConversation';

const mocks = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  hasExternalCodexThreadWriter: vi.fn(),
  clearPendingInitialPrompt: vi.fn(),
  startSession: vi.fn(),
  resolveTask: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
  },
}));

vi.mock('@main/db/schema', () => ({
  conversations: {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./codex-thread-writer', () => ({
  hasExternalCodexThreadWriter: mocks.hasExternalCodexThreadWriter,
}));

vi.mock('./pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: mocks.clearPendingInitialPrompt,
}));

vi.mock('./utils', () => ({
  mapConversationRowToConversation: vi.fn((row: unknown) => row),
}));

describe('resumeConversation', () => {
  const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');

  function registerTestPty(registrationEpoch: number): void {
    const pty: Pty = {
      write: vi.fn(),
      resize: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    ptySessionRegistry.register(sessionId, pty, { registrationEpoch });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTask.mockReturnValue({
      conversations: {
        getActiveSessions: mocks.getActiveSessions,
        startSession: mocks.startSession,
        waitsForInitialPromptSessionBinding: (runtimeId: string) => runtimeId === 'codex',
      },
    });
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ]);
    mocks.hasExternalCodexThreadWriter.mockResolvedValue(false);
    mocks.getActiveSessions.mockReturnValue([]);
    mocks.startSession.mockImplementation(async () => {
      mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
    });
    mocks.clearPendingInitialPrompt.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    ptySessionRegistry.unsubscribe(sessionId, 'renderer-1');
    ptySessionRegistry.unregister(sessionId);
    await registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      Promise.resolve()
    );
  });

  it('coalesces concurrent resume requests for the same conversation', async () => {
    await expect(
      Promise.all([
        resumeConversation('project-1', 'task-1', 'conv-1'),
        resumeConversation('project-1', 'task-1', 'conv-1'),
      ])
    ).resolves.toEqual([true, true]);

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
  });

  it('waits for attempted-prompt hydration before renderer resume inspects the session', async () => {
    let finishHydration!: () => void;
    const hydration = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      hydration
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    expect(mocks.resolveTask).not.toHaveBeenCalled();
    expect(ptySessionRegistry.getDiagnostics(sessionId)?.registering).toBe(true);

    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
    finishHydration();
    await expect(resumed).resolves.toBe(true);

    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('accepts a live PTY that consumed the same registration epoch during hydration', async () => {
    let finishHydration!: () => void;
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    registerTestPty(registrationEpoch);
    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
    finishHydration();

    await expect(resumed).resolves.toBe(true);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('rejects a resume whose same-epoch PTY was unregistered during hydration', async () => {
    let finishHydration!: () => void;
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    registerTestPty(registrationEpoch);
    ptySessionRegistry.unregister(sessionId);
    finishHydration();

    await expect(resumed).resolves.toBe(false);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('rejects a resume after a replacement registration advances the epoch', async () => {
    let finishHydration!: () => void;
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    registerTestPty(registrationEpoch);
    const replacementEpoch = ptySessionRegistry.beginRegistration(sessionId);
    registerTestPty(replacementEpoch);
    finishHydration();

    await expect(resumed).resolves.toBe(false);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('rejects an old live registration once a newer epoch is pending', async () => {
    let finishHydration!: () => void;
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    registerTestPty(registrationEpoch);
    expect(ptySessionRegistry.beginRegistration(sessionId)).toBeGreaterThan(registrationEpoch);
    finishHydration();

    await expect(resumed).resolves.toBe(false);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('suppresses transcript fallback while explicit resume waits for startup hydration', async () => {
    let finishHydration!: () => void;
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );

    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    const snapshot = await ptySessionRegistry.subscribeForRenderer(sessionId, 'renderer-1');

    expect(snapshot).toMatchObject({
      buffer: '',
      generation: ptySessionRegistry.getGeneration(sessionId),
      sequence: 0,
    });
    expect(ptySessionRegistry.getDiagnostics(sessionId)?.registering).toBe(true);

    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
    finishHydration();
    await expect(resumed).resolves.toBe(true);
    expect(ptySessionRegistry.getDiagnostics(sessionId)?.registering).not.toBe(true);
  });

  it('reports when startup completes without a live provider session', async () => {
    mocks.startSession.mockResolvedValue(undefined);
    mocks.getActiveSessions.mockReturnValue([]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(false);
  });

  it('does not resume a conversation cancelled while startup hydration was pending', async () => {
    let finishHydration!: () => void;
    void registerConversationHydrationBarrier(
      { id: 'conv-1', projectId: 'project-1', taskId: 'task-1' },
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
    );
    const resumed = resumeConversation('project-1', 'task-1', 'conv-1');
    await Promise.resolve();
    cancelConversationHydrationBarrier('project-1', 'task-1', 'conv-1');
    finishHydration();

    await expect(resumed).resolves.toBe(false);

    expect(mocks.resolveTask).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('does not resume an archived conversation after hydration settles', async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        archivedAt: '2026-08-11T12:00:00.000Z',
      },
    ]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(false);

    expect(mocks.resolveTask).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('replays a pending Codex first prompt as a fresh session', async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        pendingInitialPrompt: {
          prompt: 'Restore the original task',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'ultra',
        },
      },
    ]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(true);

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      undefined,
      false,
      'Restore the original task',
      undefined,
      undefined,
      { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' }
    );
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('does not restart after stop cancels registration during the database lookup', async () => {
    let finishLookup!: (rows: unknown[]) => void;
    mocks.selectChain.limit.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = resolve;
      })
    );

    const resumePromise = resumeConversation('project-1', 'task-1', 'conv-1');
    ptySessionRegistry.unregister(sessionId);
    finishLookup([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ]);
    await expect(resumePromise).resolves.toBe(false);

    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('keeps imported Codex history read-only while another process owns its writer', async () => {
    const sessionSource = {
      catalogId: 'catalog-1',
      runtimeId: 'codex' as const,
      sessionId: 'codex-thread-1',
      stateRoot: '/state',
    };
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        sessionSource,
      },
    ]);
    mocks.hasExternalCodexThreadWriter.mockResolvedValueOnce(true);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(false);

    expect(mocks.hasExternalCodexThreadWriter).toHaveBeenCalledWith(sessionSource);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('reuses a Yoda-owned imported session without treating its writer as external', async () => {
    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(true);

    expect(mocks.hasExternalCodexThreadWriter).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('strictly reattaches a detached active tmux session', async () => {
    mocks.getActiveSessions.mockReturnValue([
      { conversationId: 'conv-1', detachable: true, transportAttached: false },
    ]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(true);

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    expect(mocks.startSession.mock.calls[0]?.[7]).toEqual({
      reattachExistingTmuxSession: true,
    });
    expect(mocks.getActiveSessions()).toEqual([{ conversationId: 'conv-1' }]);
  });

  it('falls back to a normal start when a detached tmux pane disappears before reattach', async () => {
    mocks.getActiveSessions.mockReturnValue([
      { conversationId: 'conv-1', detachable: true, transportAttached: false },
    ]);
    mocks.startSession
      .mockRejectedValueOnce(new TmuxReattachMissError())
      .mockImplementationOnce(async () => {
        mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
      });

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(true);

    expect(mocks.startSession).toHaveBeenCalledTimes(2);
    expect(mocks.startSession.mock.calls[0]?.[7]).toEqual({
      reattachExistingTmuxSession: true,
    });
    expect(mocks.startSession.mock.calls[1]?.[7]).toBeUndefined();
    expect(mocks.getActiveSessions()).toEqual([{ conversationId: 'conv-1' }]);
  });
});
