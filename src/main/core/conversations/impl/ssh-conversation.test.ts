import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
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
  setRuntimeStatus: vi.fn(),
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
  killTmuxSession: vi.fn(),
  sendLiteralToTmuxSession: vi.fn(),
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
    mocks.maybeAutoTrustSsh.mockResolvedValue(undefined);
    mocks.maybeAutoTrustCodexSsh.mockResolvedValue(undefined);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue(undefined);
    mocks.resolveRuntimeEnv.mockReturnValue(undefined);
    mocks.resolveRuntimeTmuxEnv.mockReturnValue(undefined);
    mocks.resolveSshCommand.mockReturnValue('SSH_COMMAND');
    mocks.resolveTerminalThemeMode.mockResolvedValue('dark');
  });

  afterEach(async () => {
    await provider?.detachAll();
    provider = null;
    ptySessionRegistry.unregister(sessionId);
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
