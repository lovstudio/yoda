import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { sessionOpenPerformanceChannel } from '@shared/session-open-performance';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import {
  cancelConversationHydrationBarrier,
  registerConversationHydrationBarrier,
} from './conversation-hydration-barrier';
import { resumeConversation, resumeConversationWithResult } from './resumeConversation';

const mocks = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  hasExternalCodexThreadWriter: vi.fn(),
  loadCodexRolloutSurfaceAnchor: vi.fn(),
  clearPendingInitialPrompt: vi.fn(),
  emitEvent: vi.fn(),
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
    emit: mocks.emitEvent,
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./codex-thread-writer', () => ({
  hasExternalCodexThreadWriter: mocks.hasExternalCodexThreadWriter,
}));

vi.mock('./codex-rollout-terminal-history', () => ({
  loadCodexRolloutSurfaceAnchorForConversation: mocks.loadCodexRolloutSurfaceAnchor,
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
        taskPath: '/repo/worktree',
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
    mocks.loadCodexRolloutSurfaceAnchor.mockResolvedValue({
      kind: 'anchor',
      segments: ['The durable transcript answer is visible.'],
    });
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

  it('reports the correlated main-process resume stages in execution order', async () => {
    await expect(
      resumeConversation(
        'project-1',
        'task-1',
        'conv-1',
        { cols: 120, rows: 40 },
        {
          contextId: 'task-open-1',
          clickAtEpochMs: Date.now(),
        }
      )
    ).resolves.toBe(true);

    const entries = mocks.emitEvent.mock.calls
      .filter(([channel]) => channel === sessionOpenPerformanceChannel)
      .map(([, entry]) => entry as { context_id: string; stage: string });
    expect(entries.every((entry) => entry.context_id === 'task-open-1')).toBe(true);
    expect(entries.map((entry) => entry.stage)).toEqual([
      'resume-received',
      'hydration-barrier',
      'operation-lock',
      'conversation-query',
      'task-resolve',
      'permission-reconcile',
      'session-classified',
      'surface-anchor',
      'external-writer-probe',
      'provider-start',
      'resume-resolved',
    ]);
    expect(mocks.startSession.mock.calls[0]?.[7]).toEqual({
      performanceTrace: expect.any(Object),
    });
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

  it('returns the transcript surface anchor for an already active Codex session', async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
      },
    ]);
    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);

    await expect(resumeConversationWithResult('project-1', 'task-1', 'conv-1')).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: true,
      surfaceAnchor: {
        kind: 'anchor',
        segments: ['The durable transcript answer is visible.'],
      },
    });

    expect(mocks.loadCodexRolloutSurfaceAnchor).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ id: 'conv-1', runtimeId: 'codex' }),
      cwd: '/repo/worktree',
    });
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('starts the provider without serially waiting for surface-anchor extraction', async () => {
    let finishAnchor!: (value: { kind: 'anchor'; segments: string[] }) => void;
    mocks.loadCodexRolloutSurfaceAnchor.mockReturnValueOnce(
      new Promise((resolve) => {
        finishAnchor = resolve;
      })
    );
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
      },
    ]);

    const resumed = resumeConversationWithResult('project-1', 'task-1', 'conv-1');
    await vi.waitFor(() => expect(mocks.startSession).toHaveBeenCalledTimes(1));

    finishAnchor({ kind: 'anchor', segments: ['The final frame evidence is now available.'] });
    await expect(resumed).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: true,
      surfaceAnchor: {
        kind: 'anchor',
        segments: ['The final frame evidence is now available.'],
      },
    });
  });

  it('marks a fresh first-prompt start as having no historical surface anchor', async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        pendingInitialPrompt: { prompt: 'Create the first turn' },
      },
    ]);

    await expect(resumeConversationWithResult('project-1', 'task-1', 'conv-1')).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: true,
      surfaceAnchor: { kind: 'none' },
    });

    expect(mocks.loadCodexRolloutSurfaceAnchor).not.toHaveBeenCalled();
  });

  it('keeps a resumed session conservative when anchor extraction fails', async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
      },
    ]);
    mocks.loadCodexRolloutSurfaceAnchor.mockRejectedValueOnce(new Error('rollout unavailable'));

    await expect(resumeConversationWithResult('project-1', 'task-1', 'conv-1')).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: true,
      surfaceAnchor: { kind: 'unverifiable' },
    });
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

    await expect(resumeConversationWithResult('project-1', 'task-1', 'conv-1')).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: false,
      reason: 'external-writer',
    });

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
    mocks.selectChain.limit.mockResolvedValueOnce([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
      },
    ]);
    mocks.getActiveSessions.mockReturnValue([
      { conversationId: 'conv-1', detachable: true, transportAttached: false },
    ]);

    await expect(resumeConversationWithResult('project-1', 'task-1', 'conv-1')).resolves.toEqual({
      generation: ptySessionRegistry.getGeneration(sessionId),
      running: true,
      surfaceAnchor: {
        kind: 'anchor',
        segments: ['The durable transcript answer is visible.'],
      },
    });

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
