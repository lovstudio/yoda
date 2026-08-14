import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { sessionOpenPerformanceChannel } from '@shared/session-open-performance';
import {
  registerConversationHydrationBarrier,
  wasConversationHydrationCancelled,
} from '@main/core/conversations/conversation-hydration-barrier';
import { createSessionOpenPerformanceTrace } from '@main/core/conversations/session-open-performance';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import {
  PTY_RENDERER_DETACH_GRACE_MS,
  ptySessionRegistry,
} from '@main/core/pty/pty-session-registry';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { SshConversationProvider } from './ssh-conversation';

const mocks = vi.hoisted(() => ({
  attachSilenceReconciler: vi.fn(),
  buildAgentCommand: vi.fn(),
  captureTelemetry: vi.fn(),
  createClaudeInterruptSniffer: vi.fn(),
  dispatchRuntimeStatus: vi.fn(),
  emitEvent: vi.fn(),
  getEnabledPromptPrinciplesText: vi.fn(),
  getProviderConfig: vi.fn(),
  getRemoteShellProfile: vi.fn(),
  injectTuiStartupInput: vi.fn(),
  killTmuxSession: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  maybeAutoTrustSsh: vi.fn(),
  maybeAutoTrustCodexSsh: vi.fn(),
  noteOutput: vi.fn(),
  openSsh2Pty: vi.fn(),
  removeRuntimeStatus: vi.fn(),
  resolveAvailableTmuxSessionName: vi.fn(),
  resolveRuntimeEnv: vi.fn(),
  resolveRuntimeTmuxEnv: vi.fn(),
  resolveSshCommand: vi.fn(),
  resolveTerminalThemeMode: vi.fn(),
  sendLiteralToTmuxSession: vi.fn(),
  setRuntimeStatus: vi.fn(),
  waitForTmuxReattach: vi.fn(),
  wireAgentClassifier: vi.fn(),
}));

vi.mock('@main/core/agent-hooks/classifier-wiring', () => ({
  wireAgentClassifier: mocks.wireAgentClassifier,
}));

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustSsh: mocks.maybeAutoTrustSsh,
  },
}));

vi.mock('@main/core/agent-hooks/codex-trust-service', () => ({
  codexTrustService: {
    maybeAutoTrustSsh: mocks.maybeAutoTrustCodexSsh,
  },
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    dispatch: mocks.dispatchRuntimeStatus,
    remove: mocks.removeRuntimeStatus,
    setStatus: mocks.setRuntimeStatus,
  },
}));

vi.mock('@main/core/conversations/agent-silence-reconciler', () => ({
  agentSilenceReconciler: {
    attach: mocks.attachSilenceReconciler,
    noteOutput: mocks.noteOutput,
  },
}));

vi.mock('@main/core/conversations/claude-interrupt-sniffer', () => ({
  createClaudeInterruptSniffer: mocks.createClaudeInterruptSniffer,
}));

vi.mock('@main/core/conversations/session-stats-hooks', () => ({
  recordConversationAuthProvider: vi.fn(),
  snapshotConversationUsageOnSessionExit: vi.fn(),
  snapshotTaskDiffOnSessionExit: vi.fn(),
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: class {},
}));

vi.mock('@main/core/pty/spawn-utils', () => ({
  resolveSshCommand: mocks.resolveSshCommand,
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty: mocks.openSsh2Pty,
}));

vi.mock('@main/core/pty/tmux-availability', () => ({
  resolveAvailableTmuxSessionName: mocks.resolveAvailableTmuxSessionName,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession: mocks.killTmuxSession,
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
  sendLiteralToTmuxSession: mocks.sendLiteralToTmuxSession,
}));

vi.mock('@main/core/pty/tmux-reattach', () => ({
  TmuxReattachMissError: class TmuxReattachMissError extends Error {},
  waitForTmuxReattach: mocks.waitForTmuxReattach,
}));

vi.mock('@main/core/settings/resolve-terminal-theme-mode', () => ({
  resolveTerminalThemeMode: mocks.resolveTerminalThemeMode,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getProviderConfig,
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emitEvent,
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

vi.mock('./agent-command', () => ({
  buildAgentCommand: mocks.buildAgentCommand,
}));

vi.mock('./image-attachments', () => ({
  substituteImageMentions: (prompt: string | undefined) => prompt,
}));

vi.mock('./tui-startup-input', () => ({
  injectTuiStartupInput: mocks.injectTuiStartupInput,
}));

vi.mock('./prompt-principles', () => ({
  getEnabledPromptPrinciplesText: mocks.getEnabledPromptPrinciplesText,
}));

vi.mock('./runtime-env', () => ({
  resolveRuntimeEnv: mocks.resolveRuntimeEnv,
  resolveRuntimeTmuxEnv: mocks.resolveRuntimeTmuxEnv,
}));

class FakePty implements Pty {
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  readonly attemptedWrites: string[] = [];
  readonly writes: string[] = [];
  killCalls = 0;
  writeError: Error | null = null;
  bufferedExit: PtyExitInfo | null = null;

  write(data: string): void {
    this.attemptedWrites.push(data);
    if (this.writeError) throw this.writeError;
    this.writes.push(data);
  }

  resize(): void {}

  pause(): void {}

  resume(): void {}

  kill(): void {
    this.killCalls += 1;
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
    if (this.bufferedExit) queueMicrotask(() => handler(this.bufferedExit as PtyExitInfo));
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error('Deferred promise is not initialized');
      resolvePromise(value);
    },
  };
}

const conversation: Conversation = {
  id: 'conv-ssh-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'claude',
  title: 'SSH Claude',
  lastInteractedAt: null,
  autoApprove: false,
  isInitialConversation: true,
};

const sessionId = makePtySessionId(conversation.projectId, conversation.taskId, conversation.id);

function createProvider(): SshConversationProvider {
  const proxy = {
    client: {},
    getRemoteShellProfile: mocks.getRemoteShellProfile,
  } as unknown as SshClientProxy;
  return new SshConversationProvider({
    projectId: conversation.projectId,
    taskId: conversation.taskId,
    taskPath: '/remote/workspace',
    ctx: {} as IExecutionContext,
    proxy,
    connectionId: 'ssh-connection-1',
  });
}

describe('SshConversationProvider registration lifecycle', () => {
  let provider: SshConversationProvider | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attachSilenceReconciler.mockReturnValue(vi.fn());
    mocks.buildAgentCommand.mockReturnValue({ command: 'claude', args: [] });
    mocks.createClaudeInterruptSniffer.mockReturnValue(vi.fn());
    mocks.getEnabledPromptPrinciplesText.mockResolvedValue(undefined);
    mocks.getProviderConfig.mockResolvedValue(undefined);
    mocks.getRemoteShellProfile.mockResolvedValue({});
    mocks.injectTuiStartupInput.mockResolvedValue(true);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    mocks.maybeAutoTrustSsh.mockResolvedValue(undefined);
    mocks.maybeAutoTrustCodexSsh.mockResolvedValue(undefined);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue(undefined);
    mocks.resolveRuntimeEnv.mockReturnValue(undefined);
    mocks.resolveRuntimeTmuxEnv.mockReturnValue(undefined);
    mocks.resolveSshCommand.mockReturnValue('SSH_COMMAND');
    mocks.resolveTerminalThemeMode.mockResolvedValue('dark');
    mocks.waitForTmuxReattach.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await provider?.detachAll();
    provider = null;
    ptySessionRegistry.unregister(sessionId);
    vi.useRealTimers();
  });

  it('kills and discards a PTY that resolves after stopSession cancels its pending start', async () => {
    const pendingOpen = deferred<{ success: true; data: FakePty }>();
    mocks.openSsh2Pty.mockReturnValue(pendingOpen.promise);
    const pty = new FakePty();
    provider = createProvider();

    const startPromise = provider.startSession(conversation);
    await vi.waitFor(() => expect(mocks.openSsh2Pty).toHaveBeenCalledOnce());
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'stale input')).toBe('queued');

    await provider.stopSession(conversation.id);
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'after stop')).toBe('unavailable');

    pendingOpen.resolve({ success: true, data: pty });
    await startPromise;

    expect(pty.killCalls).toBe(1);
    expect(pty.writes).toEqual([]);
    expect(provider.getActiveSessionCount()).toBe(0);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();

    const freshEpoch = ptySessionRegistry.beginRegistration(sessionId);
    const freshPty = new FakePty();
    ptySessionRegistry.register(sessionId, freshPty, { registrationEpoch: freshEpoch });
    expect(freshPty.writes).toEqual([]);
  });

  it('cancels first-prompt hydration when task teardown detaches a pending SSH start', async () => {
    const pendingOpen = deferred<{ success: true; data: FakePty }>();
    mocks.openSsh2Pty.mockReturnValue(pendingOpen.promise);
    const pty = new FakePty();
    provider = createProvider();

    const startup = provider.startSession(conversation);
    const hydration = registerConversationHydrationBarrier(conversation, startup);
    await vi.waitFor(() => expect(mocks.openSsh2Pty).toHaveBeenCalledOnce());

    await provider.detachAll();
    pendingOpen.resolve({ success: true, data: pty });
    await hydration;

    expect(wasConversationHydrationCancelled(hydration)).toBe(true);
    expect(pty.killCalls).toBe(1);
    expect(provider.getActiveSessionCount()).toBe(0);
  });

  it('cancels marker-delayed hydration before the SSH provider starts', async () => {
    const pendingMarker = deferred<void>();
    const hydration = registerConversationHydrationBarrier(conversation, pendingMarker.promise);
    provider = createProvider();

    await provider.detachAll();
    pendingMarker.resolve(undefined);
    await hydration;

    expect(wasConversationHydrationCancelled(hydration)).toBe(true);
    expect(mocks.openSsh2Pty).not.toHaveBeenCalled();
  });

  it('single-flights concurrent starts for the same session', async () => {
    const pendingOpen = deferred<{ success: true; data: FakePty }>();
    mocks.openSsh2Pty.mockReturnValue(pendingOpen.promise);
    const pty = new FakePty();
    provider = createProvider();

    const firstStart = provider.startSession(conversation);
    const secondStart = provider.startSession(conversation);
    await vi.waitFor(() => expect(mocks.openSsh2Pty).toHaveBeenCalledOnce());

    pendingOpen.resolve({ success: true, data: pty });
    await Promise.all([firstStart, secondStart]);

    expect(mocks.openSsh2Pty).toHaveBeenCalledOnce();
    expect(provider.getActiveSessionCount()).toBe(1);
    expect(ptySessionRegistry.get(sessionId)).toBe(pty);
    expect(pty.killCalls).toBe(0);
  });

  it('reports SSH spawn, registration, and the first non-empty PTY output', async () => {
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    provider = createProvider();
    const performanceTrace = createSessionOpenPerformanceTrace(
      { contextId: 'task-open-ssh-1', clickAtEpochMs: Date.now() },
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        sessionId,
      }
    );
    if (!performanceTrace) throw new Error('Expected performance trace');

    await provider.startSession(
      conversation,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { performanceTrace }
    );
    pty.emitData('');
    pty.emitData('ssh-ready');
    pty.emitData('later');

    const entries = mocks.emitEvent.mock.calls
      .filter(([channel]) => channel === sessionOpenPerformanceChannel)
      .map(
        ([, entry]) =>
          entry as {
            stage: string;
            attempt?: string;
            byteLength?: number;
            reattachExisting?: boolean;
            transport?: string;
          }
      );
    expect(entries.map((entry) => entry.stage)).toEqual(
      expect.arrayContaining([
        'provider-preflight',
        'provider-spawn',
        'pty-registered',
        'tmux-reattach-confirm',
        'provider-committed',
        'pty-first-output',
      ])
    );
    expect(entries.filter((entry) => entry.stage === 'pty-first-output')).toEqual([
      expect.objectContaining({
        attempt: 'resume',
        byteLength: 9,
        reattachExisting: false,
        transport: 'ssh',
      }),
    ]);
  });

  it('reports first output independently for a failed strict reattach and its fallback PTY', async () => {
    const reattachPty = new FakePty();
    const fallbackPty = new FakePty();
    mocks.openSsh2Pty
      .mockResolvedValueOnce({ success: true, data: reattachPty })
      .mockResolvedValueOnce({ success: true, data: fallbackPty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/remote/workspace', attachedClients: 0 },
    ]);
    mocks.waitForTmuxReattach.mockImplementationOnce(({ pty }: { pty: FakePty }) => {
      pty.emitData('strict-output');
      return Promise.reject(new TmuxReattachMissError());
    });
    provider = createProvider();
    const performanceTrace = createSessionOpenPerformanceTrace(
      { contextId: 'task-open-ssh-fallback', clickAtEpochMs: Date.now() },
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        sessionId,
      }
    );
    if (!performanceTrace) throw new Error('Expected performance trace');

    await expect(
      provider.startSession(
        conversation,
        { cols: 80, rows: 24 },
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        { reattachExistingTmuxSession: true, performanceTrace }
      )
    ).rejects.toBeInstanceOf(TmuxReattachMissError);

    await provider.startSession(
      conversation,
      { cols: 80, rows: 24 },
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { performanceTrace }
    );
    fallbackPty.emitData('fallback-output');

    const firstOutputEntries = mocks.emitEvent.mock.calls
      .filter(
        ([channel, entry]) =>
          channel === sessionOpenPerformanceChannel &&
          (entry as { stage?: string }).stage === 'pty-first-output'
      )
      .map(([, entry]) => entry);
    expect(firstOutputEntries).toEqual([
      expect.objectContaining({
        attempt: 'reattach',
        byteLength: 13,
        reattachExisting: true,
        transport: 'ssh',
      }),
      expect.objectContaining({
        attempt: 'resume',
        byteLength: 15,
        reattachExisting: false,
        transport: 'ssh',
      }),
    ]);
  });

  it('rejects startup when the SSH channel cannot be opened', async () => {
    mocks.openSsh2Pty.mockResolvedValue({
      success: false,
      error: new Error('channel refused'),
    });
    provider = createProvider();

    await expect(provider.startSession(conversation)).rejects.toThrow(
      'Failed to open SSH channel: channel refused'
    );

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
  });

  it('rejects a channel that closed before startup could acknowledge the first prompt', async () => {
    const pty = new FakePty();
    pty.bufferedExit = { exitCode: 0 };
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    provider = createProvider();

    await expect(
      provider.startSession(
        { ...conversation, runtimeId: 'codex' },
        undefined,
        false,
        'Deliver this once'
      )
    ).rejects.toThrow('codex exited during SSH startup');

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
  });

  it('injects runtime startup input after registering the remote PTY', async () => {
    const pty = new FakePty();
    mocks.buildAgentCommand.mockReturnValue({
      command: 'codex',
      args: ['--sandbox', 'read-only', '--ask-for-approval', 'never'],
      startupInput: '/plan Inspect the repository',
    });
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    provider = createProvider();

    await provider.startSession({ ...conversation, runtimeId: 'codex', permissionMode: 'plan' });

    expect(mocks.injectTuiStartupInput).toHaveBeenCalledWith({
      pty,
      runtimeId: 'codex',
      input: '/plan Inspect the repository',
    });
  });

  it('marks a canonical tmux pane as attach-only during startup hydration', async () => {
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/remote/workspace', attachedClients: 0 },
    ]);
    provider = createProvider();

    await provider.startSession(
      conversation,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { reattachExistingTmuxSession: true }
    );

    expect(mocks.resolveSshCommand).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({
        tmuxSessionName: 'tmux-session',
        tmuxReattachExistingSession: true,
      }),
      expect.anything(),
      expect.anything()
    );
    expect(mocks.waitForTmuxReattach).toHaveBeenCalledWith({
      ctx: expect.anything(),
      pty,
      baseline: { sessionName: 'tmux-session', cwd: '/remote/workspace', attachedClients: 0 },
    });
    expect(mocks.setRuntimeStatus).not.toHaveBeenCalled();
  });

  it('rejects SSH startup when the strict tmux attach misses after the channel opens', async () => {
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/remote/workspace', attachedClients: 0 },
    ]);
    mocks.waitForTmuxReattach.mockRejectedValueOnce(new Error('reattach missed'));
    provider = createProvider();

    await expect(
      provider.startSession(
        conversation,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        { reattachExistingTmuxSession: true }
      )
    ).rejects.toThrow('reattach missed');

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(pty.killCalls).toBe(1);
  });

  it('detaches only the SSH tmux attach channel after the final renderer checkpoint goes idle', async () => {
    vi.useFakeTimers();
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    provider = createProvider();
    await provider.startSession(conversation);
    const generation = ptySessionRegistry.getGeneration(sessionId);
    ptySessionRegistry.subscribe(sessionId, 'renderer');

    expect(
      ptySessionRegistry.checkpointAndUnsubscribe(sessionId, 'renderer', {
        buffer: '\x1bcCURRENT SSH TMUX FRAME',
        generation,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(PTY_RENDERER_DETACH_GRACE_MS);

    expect(pty.killCalls).toBe(1);
    expect(mocks.killTmuxSession).not.toHaveBeenCalled();
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    expect(provider.getActiveSessions()).toEqual([
      expect.objectContaining({
        sessionId,
        conversationId: conversation.id,
        detachable: true,
        transportAttached: false,
      }),
    ]);

    mocks.dispatchRuntimeStatus.mockClear();
    mocks.emitEvent.mockClear();
    pty.emitExit({ exitCode: 0 });

    expect(mocks.dispatchRuntimeStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'process-exited' }),
      'process-exited'
    );
    expect(mocks.emitEvent).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());
    expect(provider.getActiveSessions()[0]).toMatchObject({
      detachable: true,
      transportAttached: false,
    });
  });

  it('strictly reattaches the retained SSH tmux identity from a one-off override', async () => {
    vi.useFakeTimers();
    const firstPty = new FakePty();
    const secondPty = new FakePty();
    mocks.openSsh2Pty
      .mockResolvedValueOnce({ success: true, data: firstPty })
      .mockResolvedValueOnce({ success: true, data: secondPty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValueOnce('one-off-tmux');
    provider = createProvider();
    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, undefined, true);
    const generation = ptySessionRegistry.getGeneration(sessionId);
    ptySessionRegistry.subscribe(sessionId, 'renderer');
    expect(
      ptySessionRegistry.checkpointAndUnsubscribe(sessionId, 'renderer', {
        buffer: '\x1bcONE OFF SSH FRAME',
        generation,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(PTY_RENDERER_DETACH_GRACE_MS);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue(undefined);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'one-off-tmux', cwd: '/remote/workspace', attachedClients: 0 },
    ]);

    await provider.startSession(
      conversation,
      { cols: 80, rows: 24 },
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { reattachExistingTmuxSession: true }
    );

    expect(mocks.resolveAvailableTmuxSessionName).toHaveBeenCalledTimes(1);
    expect(mocks.resolveSshCommand).toHaveBeenLastCalledWith(
      'agent',
      expect.objectContaining({
        tmuxSessionName: 'one-off-tmux',
        tmuxReattachExistingSession: true,
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('refreshes detached activity before sending input through SSH tmux', async () => {
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    provider = createProvider();
    await provider.startSession(conversation);
    (
      provider as unknown as {
        sessions: Map<string, Pty>;
      }
    ).sessions.delete(sessionId);
    const queuedAt = Date.now();

    await expect(provider.sendInput(conversation.id, 'mobile follow-up')).resolves.toBe(true);

    expect(mocks.sendLiteralToTmuxSession).toHaveBeenCalledWith(
      expect.anything(),
      'tmux-session',
      'mobile follow-up'
    );
    expect(provider.getActiveSessions()[0]).toMatchObject({
      transportAttached: false,
      transportDetachedAt: expect.any(Number),
    });
    expect(provider.getActiveSessions()[0]?.transportDetachedAt).toBeGreaterThanOrEqual(queuedAt);
  });

  it('detaches silence tracking when stop removes the live PTY', async () => {
    const detach = vi.fn();
    mocks.attachSilenceReconciler.mockReturnValue(detach);
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    provider = createProvider();

    await provider.startSession(conversation);
    await provider.stopSession(conversation.id);

    expect(detach).toHaveBeenCalledOnce();
  });

  it('rolls back the PTY and registry when queued-input drain throws', async () => {
    const pty = new FakePty();
    pty.writeError = new Error('write failed');
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    provider = createProvider();

    const startPromise = provider.startSession(conversation);
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'queued command')).toBe('queued');

    await expect(startPromise).rejects.toThrow('write failed');

    expect(pty.attemptedWrites).toEqual(['queued command']);
    expect(pty.killCalls).toBe(1);
    expect(provider.getActiveSessionCount()).toBe(0);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'late command')).toBe('unavailable');
  });
});
