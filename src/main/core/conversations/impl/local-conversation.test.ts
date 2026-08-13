import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { agentSilenceReconciler } from '@main/core/conversations/agent-silence-reconciler';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type * as ImageAttachments from './image-attachments';
import { LocalConversationProvider } from './local-conversation';

const mocks = vi.hoisted(() => ({
  appSettingsGet: vi.fn(),
  aiLogFinish: vi.fn(),
  aiLogStart: vi.fn(),
  buildAgentEnv: vi.fn(),
  captureTelemetry: vi.fn(),
  emitEvent: vi.fn(),
  getHookPort: vi.fn(),
  getHookToken: vi.fn(),
  getProviderConfig: vi.fn(),
  getRuntimeInferenceCredentials: vi.fn(),
  injectClipboardImagesAndPrompt: vi.fn(),
  injectTuiStartupInput: vi.fn(),
  ensureCodexResumeProviderCompatible: vi.fn(),
  ensureCodexMaasCompatibleModelCatalog: vi.fn(),
  killTmuxSession: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  repairCodexThreadHistoryProjection: vi.fn(),
  repairCodexDuplicatedSessionMetaBoundary: vi.fn(),
  migrateLegacyCodexMaasHistory: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  maybeAutoTrustLocal: vi.fn(),
  maybeAutoTrustCodexLocal: vi.fn(),
  prepareHookConfig: vi.fn(),
  prepareWindowsClaudeSettings: vi.fn(),
  promptLibraryList: vi.fn(),
  reconcileCodexStateRoot: vi.fn(),
  recordPendingInitialPromptAttempt: vi.fn(),
  ensureCodexThreadUnarchived: vi.fn(),
  findAcknowledgedCodexThreadForInitialPrompt: vi.fn(),
  resolveAvailableTmuxSessionName: vi.fn(),
  resolveAgentResumeSessionId: vi.fn(),
  resolveCodexThreadIdForConversation: vi.fn(),
  resolveLocalPtySpawn: vi.fn(),
  dispatchRuntimeStatus: vi.fn(),
  removeRuntimeStatus: vi.fn(),
  sendLiteralToTmuxSession: vi.fn(),
  setInteractiveSessionContext: vi.fn(),
  setRuntimeStatus: vi.fn(),
  spawnLocalPty: vi.fn(),
  startTitle: vi.fn(),
  storeConversationSessionSource: vi.fn(),
  stopTitle: vi.fn(),
  watchClaudeRunState: vi.fn(() => ({ stop: vi.fn() })),
  watchClaudeSessionActivity: vi.fn(() => ({ stop: vi.fn() })),
  watchCodexRunState: vi.fn(() => ({ stop: vi.fn() })),
  waitForTmuxReattach: vi.fn(),
  wireAgentClassifier: vi.fn(),
}));

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: {
    getPort: mocks.getHookPort,
    getToken: mocks.getHookToken,
  },
}));

vi.mock('@main/core/agent-hooks/classifier-wiring', () => ({
  wireAgentClassifier: mocks.wireAgentClassifier,
}));

vi.mock('@main/core/ai-logs/ai-log-service', () => ({
  aiLogService: {
    start: mocks.aiLogStart,
    finish: mocks.aiLogFinish,
  },
}));

vi.mock('@main/core/ai-logs/interactive-turn-logger', () => ({
  interactiveTurnLogger: {
    setSessionContext: mocks.setInteractiveSessionContext,
    clearSessionContext: vi.fn(),
    onAgentEvent: vi.fn().mockResolvedValue(undefined),
    onSessionExit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustLocal: mocks.maybeAutoTrustLocal,
  },
}));

vi.mock('@main/core/agent-hooks/codex-trust-service', () => ({
  codexTrustService: {
    maybeAutoTrustLocal: mocks.maybeAutoTrustCodexLocal,
  },
}));

vi.mock('@main/core/agent-hooks/hook-config', () => ({
  HookConfigWriter: class {
    writeForProvider = mocks.prepareHookConfig;
  },
}));

vi.mock('@main/core/agent-hooks/inspect/hook-overrides-apply', () => ({
  applyHookOverrides: vi.fn(async () => {}),
}));

vi.mock('@main/core/agent-hooks/inspect/hook-overrides-store', () => ({
  hookOverridesStore: {
    get: vi.fn(async () => ({ disabled: [], debug: false })),
  },
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    dispatch: mocks.dispatchRuntimeStatus,
    getAllStatuses: vi.fn(() => []),
    remove: mocks.removeRuntimeStatus,
    setStatus: mocks.setRuntimeStatus,
  },
}));

vi.mock('@main/core/conversations/claude-session-activity-source', () => ({
  watchClaudeSessionActivity: mocks.watchClaudeSessionActivity,
}));

vi.mock('@main/core/conversations/claude-run-state-source', () => ({
  watchClaudeRunState: mocks.watchClaudeRunState,
}));

vi.mock('@main/core/conversations/codex-run-state-source', () => ({
  watchCodexRunState: mocks.watchCodexRunState,
}));

vi.mock('@main/core/conversations/codex-history-projection-repair', () => ({
  repairCodexDuplicatedSessionMetaBoundary: mocks.repairCodexDuplicatedSessionMetaBoundary,
  repairCodexThreadHistoryProjection: mocks.repairCodexThreadHistoryProjection,
}));

// Pulls in the DB client transitively; unit tests have no Electron app.
vi.mock('@main/core/conversations/session-stats-hooks', () => ({
  recordConversationAuthProvider: vi.fn(),
  snapshotConversationUsageOnSessionExit: vi.fn(),
  snapshotTaskDiffOnSessionExit: vi.fn(),
}));

vi.mock('@main/core/fs/impl/local-fs', () => ({
  LocalFileSystem: class {},
}));

vi.mock('@main/core/maas/maas-service', () => ({
  maasService: {
    getRuntimeInferenceCredentials: mocks.getRuntimeInferenceCredentials,
    reconcileCodexStateRoot: mocks.reconcileCodexStateRoot,
  },
}));

vi.mock('@main/core/maas/codex-history-compat', () => ({
  ensureCodexResumeProviderCompatibleForConfig: mocks.ensureCodexResumeProviderCompatible,
  migrateLegacyCodexMaasHistoryForConfig: mocks.migrateLegacyCodexMaasHistory,
}));

vi.mock('@main/core/maas/codex-maas-model-catalog', () => ({
  ensureCodexMaasCompatibleModelCatalog: mocks.ensureCodexMaasCompatibleModelCatalog,
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: mocks.spawnLocalPty,
}));

vi.mock('./tui-startup-input', () => ({
  injectTuiStartupInput: mocks.injectTuiStartupInput,
}));

vi.mock('./image-attachments', async () => {
  const actual = await vi.importActual<typeof ImageAttachments>('./image-attachments');
  return {
    ...actual,
    injectClipboardImagesAndPrompt: mocks.injectClipboardImagesAndPrompt,
  };
});

vi.mock('@main/core/prompt-library/prompt-library-service', () => ({
  promptLibraryService: {
    list: mocks.promptLibraryList,
  },
}));

vi.mock('@main/core/pty/pty-env', () => ({
  buildAgentEnv: mocks.buildAgentEnv,
}));

vi.mock('@main/core/pty/pty-spawn-platform', () => ({
  logLocalPtySpawnWarnings: () => {},
  resolveLocalPtySpawn: mocks.resolveLocalPtySpawn,
}));

vi.mock('@main/core/pty/tmux-availability', () => ({
  resolveAvailableTmuxSessionName: mocks.resolveAvailableTmuxSessionName,
}));

vi.mock('@main/core/pty/tmux-reattach', () => ({
  TmuxReattachMissError: class TmuxReattachMissError extends Error {
    constructor() {
      super('The persisted tmux session ended before it could be reattached.');
    }
  },
  waitForTmuxReattach: mocks.waitForTmuxReattach,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession: mocks.killTmuxSession,
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
  makeTmuxSessionName: (sessionId: string) => `tmux-${sessionId}`,
  sendLiteralToTmuxSession: mocks.sendLiteralToTmuxSession,
}));

vi.mock('./windows-claude-settings', () => ({
  prepareWindowsClaudeSettings: mocks.prepareWindowsClaudeSettings,
}));

vi.mock('@main/core/session-title/session-title-manager', () => ({
  sessionTitleManager: {
    start: mocks.startTitle,
    stop: mocks.stopTitle,
  },
}));

vi.mock('@main/core/session-title/codex-title-source', () => ({
  findAcknowledgedCodexThreadForInitialPrompt: mocks.findAcknowledgedCodexThreadForInitialPrompt,
  resolveCodexStatePath: (stateRoot: string) => `${stateRoot}/state_5.sqlite`,
}));

vi.mock('../codex-session-id', () => ({
  resolveAgentResumeSessionId: mocks.resolveAgentResumeSessionId,
  resolveCodexThreadIdForConversation: mocks.resolveCodexThreadIdForConversation,
}));

vi.mock('../codex-unarchive', () => ({
  ensureCodexThreadUnarchived: mocks.ensureCodexThreadUnarchived,
}));

vi.mock('../pending-initial-prompt-store', () => ({
  recordPendingInitialPromptAttempt: mocks.recordPendingInitialPromptAttempt,
}));

vi.mock('../stored-conversation-session-source', () => ({
  storeConversationSessionSource: mocks.storeConversationSessionSource,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getProviderConfig,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.appSettingsGet,
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
    debug: mocks.logDebug,
    error: mocks.logError,
    info: mocks.logInfo,
    warn: mocks.logWarn,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

type SpawnOptions = {
  id: string;
  command: string;
  args: string[];
  cwd: string;
};

class FakePty implements Pty {
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  readonly pid = 4321;
  readonly writes: string[] = [];
  killCalls = 0;
  writeError: Error | null = null;

  write(data: string): void {
    if (this.writeError) throw this.writeError;
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {
    this.killCalls += 1;
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }
}

const conversation: Conversation = {
  id: 'conv-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'claude',
  title: 'Claude',
  lastInteractedAt: null,
  autoApprove: false,
  isInitialConversation: true,
};

const sessionId = makePtySessionId(conversation.projectId, conversation.taskId, conversation.id);

function createProvider(): LocalConversationProvider {
  return new LocalConversationProvider({
    projectId: conversation.projectId,
    taskId: conversation.taskId,
    taskPath: '/workspace',
    ctx: {} as IExecutionContext,
  });
}

describe('LocalConversationProvider', () => {
  const spawned: Array<{ pty: FakePty; options: SpawnOptions }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    spawned.length = 0;
    vi.clearAllMocks();
    mocks.getHookPort.mockReturnValue(0);
    mocks.getHookToken.mockReturnValue('token');
    mocks.injectClipboardImagesAndPrompt.mockResolvedValue(undefined);
    mocks.injectTuiStartupInput.mockResolvedValue(true);
    mocks.killTmuxSession.mockResolvedValue(undefined);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    mocks.aiLogFinish.mockResolvedValue(undefined);
    mocks.aiLogStart.mockResolvedValue('ai-log-id');
    mocks.buildAgentEnv.mockReturnValue({});
    mocks.ensureCodexResumeProviderCompatible.mockReturnValue({ status: 'unchanged' });
    mocks.ensureCodexMaasCompatibleModelCatalog.mockResolvedValue(
      '/state/codex/.yoda/maas-model-catalog.json'
    );
    mocks.repairCodexThreadHistoryProjection.mockReturnValue({
      status: 'unchanged',
      reason: 'checkpoint-current',
    });
    mocks.repairCodexDuplicatedSessionMetaBoundary.mockReturnValue({
      status: 'unchanged',
      reason: 'no-duplicate-boundary',
    });
    mocks.migrateLegacyCodexMaasHistory.mockReturnValue({ rows: 0, files: 0 });
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'claude',
      resumeFlag: '--resume',
      autoApproveFlag: '--dangerously-skip-permissions',
      initialPromptFlag: '',
      sessionIdFlag: '--session-id',
    });
    mocks.appSettingsGet.mockImplementation(async (key: string) => {
      if (key === 'promptPrinciples') return { items: [] };
      if (key === 'terminal') return {};
      return { writeAgentConfigToGitIgnore: false };
    });
    mocks.maybeAutoTrustLocal.mockResolvedValue(undefined);
    mocks.maybeAutoTrustCodexLocal.mockResolvedValue(undefined);
    mocks.prepareHookConfig.mockResolvedValue(undefined);
    mocks.promptLibraryList.mockResolvedValue([]);
    mocks.prepareWindowsClaudeSettings.mockImplementation((_runtimeId: string, args: string[]) => ({
      args,
    }));
    mocks.ensureCodexThreadUnarchived.mockResolvedValue(undefined);
    mocks.sendLiteralToTmuxSession.mockResolvedValue(undefined);
    mocks.resolveAgentResumeSessionId.mockImplementation((conversation: Conversation) => {
      return conversation.sessionSource?.sessionId ?? conversation.id;
    });
    mocks.resolveCodexThreadIdForConversation.mockReturnValue('conv-1');
    mocks.recordPendingInitialPromptAttempt.mockImplementation(
      async (
        _conversationId: string,
        attemptStartedAtMs: number,
        attemptContext?: { stateRoot?: string; cwd?: string }
      ) => ({
        prompt: 'Fix this',
        attemptStartedAtMs,
        ...(attemptContext?.stateRoot ? { attemptStateRoot: attemptContext.stateRoot } : {}),
        ...(attemptContext?.cwd ? { attemptCwd: attemptContext.cwd } : {}),
      })
    );
    mocks.findAcknowledgedCodexThreadForInitialPrompt.mockReturnValue(undefined);
    mocks.storeConversationSessionSource.mockResolvedValue(true);
    mocks.waitForTmuxReattach.mockResolvedValue(undefined);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue(undefined);
    mocks.resolveLocalPtySpawn.mockImplementation(
      ({
        intent,
      }: {
        intent: {
          cwd: string;
          command: { kind: 'argv'; command: string; args: string[] };
        };
      }) => ({
        command: intent.command.command,
        args: intent.command.args,
        cwd: intent.cwd,
        warnings: [],
      })
    );
    mocks.spawnLocalPty.mockImplementation((options: SpawnOptions) => {
      const pty = new FakePty();
      spawned.push({ pty, options });
      return pty;
    });
  });

  afterEach(() => {
    ptySessionRegistry.unregister(sessionId);
    ptySessionRegistry.unsubscribe(sessionId, 'final-output-consumer');
    ptySessionRegistry.unsubscribe(sessionId, 'immediate-output-consumer');
    vi.useRealTimers();
  });

  it('does not automatically respawn an agent session after exit', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].options.args).toEqual([
      '--session-id',
      'conv-1',
      'Fix this',
      '--settings',
      '{"theme":"dark"}',
    ]);

    spawned[0].pty.emitExit({ exitCode: 0 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(spawned).toHaveLength(1);
  });

  it('waits for clipboard image and prompt delivery before startup resolves', async () => {
    let finishDelivery!: () => void;
    mocks.injectClipboardImagesAndPrompt.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDelivery = resolve;
      })
    );
    const provider = createProvider();

    let settled = false;
    const start = provider
      .startSession(conversation, { cols: 80, rows: 24 }, false, 'Inspect this image', undefined, [
        '/tmp/input.png',
      ])
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(mocks.injectClipboardImagesAndPrompt).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    finishDelivery();
    await start;

    expect(mocks.injectClipboardImagesAndPrompt).toHaveBeenCalledWith({
      pty: spawned[0].pty,
      runtimeId: 'claude',
      imagePaths: ['/tmp/input.png'],
      prompt: 'Inspect this image',
    });
  });

  it('fails startup and preserves caller recovery when clipboard delivery fails', async () => {
    mocks.injectClipboardImagesAndPrompt.mockRejectedValueOnce(new Error('clipboard failed'));
    const provider = createProvider();

    await expect(
      provider.startSession(
        conversation,
        { cols: 80, rows: 24 },
        false,
        'Inspect this image',
        undefined,
        ['/tmp/input.png']
      )
    ).rejects.toThrow('clipboard failed');

    expect(spawned[0].pty.killCalls).toBe(1);
    expect(provider.getActiveSessionCount()).toBe(0);
  });

  it('detaches silence tracking once when stop races the PTY exit callback', async () => {
    const detach = vi.fn();
    const attachSpy = vi.spyOn(agentSilenceReconciler, 'attach').mockReturnValue(detach);
    try {
      const provider = createProvider();
      await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
      const pty = spawned[0].pty;

      await provider.stopSession(conversation.id);
      pty.emitExit({ exitCode: 0 });

      expect(detach).toHaveBeenCalledOnce();
    } finally {
      attachSpy.mockRestore();
    }
  });

  it('accepts optimistic input while async startup is still preparing the PTY', async () => {
    let finishTrust!: () => void;
    mocks.maybeAutoTrustLocal.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishTrust = resolve;
      })
    );
    const provider = createProvider();

    const startPromise = provider.startSession(
      conversation,
      { cols: 80, rows: 24 },
      false,
      'Fix this'
    );
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'early input')).toBe('queued');

    finishTrust();
    await startPromise;

    expect(spawned[0].pty.writes).toEqual(['early input']);
  });

  it('does not revive a session stopped while async startup is pending', async () => {
    let finishTrust!: () => void;
    mocks.maybeAutoTrustLocal.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishTrust = resolve;
      })
    );
    const provider = createProvider();

    const startPromise = provider.startSession(
      conversation,
      { cols: 80, rows: 24 },
      false,
      'Fix this'
    );
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'stale input')).toBe('queued');

    await provider.stopSession(conversation.id);
    finishTrust();
    await startPromise;

    expect(spawned).toHaveLength(0);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'late input')).toBe('unavailable');
  });

  it('single-flights concurrent starts for the same conversation', async () => {
    let finishTrust!: () => void;
    mocks.maybeAutoTrustLocal.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishTrust = resolve;
      })
    );
    const provider = createProvider();

    const first = provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    const second = provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    await vi.waitFor(() => expect(mocks.maybeAutoTrustLocal).toHaveBeenCalledTimes(1));
    finishTrust();
    await Promise.all([first, second]);

    expect(spawned).toHaveLength(1);
    expect(ptySessionRegistry.get(sessionId)).toBe(spawned[0].pty);
  });

  it('rolls back a partially registered PTY when queued input delivery throws', async () => {
    const pty = new FakePty();
    pty.writeError = new Error('write failed');
    mocks.spawnLocalPty.mockImplementationOnce((options: SpawnOptions) => {
      spawned.push({ pty, options });
      return pty;
    });
    const provider = createProvider();

    const startPromise = provider.startSession(
      conversation,
      { cols: 80, rows: 24 },
      false,
      'Fix this'
    );
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'early input')).toBe('queued');

    await expect(startPromise).rejects.toThrow('write failed');
    expect(pty.killCalls).toBe(1);
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'late input')).toBe('unavailable');
  });

  it('lets the registry flush final output and emit exit after provider cleanup', async () => {
    const provider = createProvider();
    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    const consumerId = 'final-output-consumer';
    ptySessionRegistry.subscribe(sessionId, consumerId);

    spawned[0].pty.emitData('final output');
    spawned[0].pty.emitExit({ exitCode: 7 });

    expect(mocks.emitEvent).toHaveBeenCalledWith(
      ptyDataChannel,
      expect.objectContaining({ data: 'final output' }),
      sessionId
    );
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      ptyExitChannel,
      expect.objectContaining({ exitCode: 7, generation: expect.any(Number) }),
      sessionId
    );
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      agentSessionExitedChannel,
      expect.objectContaining({ exitCode: 7, generation: expect.any(Number), sessionId })
    );
    const eventNames = mocks.emitEvent.mock.calls.map(([event]) => event);
    expect(eventNames.indexOf(ptyDataChannel)).toBeLessThan(eventNames.indexOf(ptyExitChannel));
    expect(eventNames.indexOf(ptyExitChannel)).toBeLessThan(
      eventNames.indexOf(agentSessionExitedChannel)
    );
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });

  it('registers the PTY before immediate post-spawn output and exit can run', async () => {
    mocks.spawnLocalPty.mockImplementationOnce((options: SpawnOptions) => {
      const pty = new FakePty();
      spawned.push({ pty, options });
      void Promise.resolve().then(() => {
        pty.emitData('immediate output');
        pty.emitExit({ exitCode: 9, signal: 'SIGTERM' });
      });
      return pty;
    });
    const provider = createProvider();
    const consumerId = 'immediate-output-consumer';
    ptySessionRegistry.subscribe(sessionId, consumerId);

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.emitEvent).toHaveBeenCalledWith(
      ptyDataChannel,
      expect.objectContaining({ data: 'immediate output' }),
      sessionId
    );
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      ptyExitChannel,
      expect.objectContaining({
        exitCode: 9,
        generation: expect.any(Number),
        signal: 'SIGTERM',
      }),
      sessionId
    );
    expect(ptySessionRegistry.get(sessionId)).toBeUndefined();
    expect(mocks.aiLogFinish).toHaveBeenCalledWith('ai-log-id', {
      status: 'failed',
      error: 'Signal SIGTERM',
    });
    expect(mocks.stopTitle).toHaveBeenCalledWith(conversation.id);
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });

  it('uses provider resume arguments when explicitly resumed after exit', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    spawned[0].pty.emitExit({ exitCode: 0 });

    await provider.startSession(conversation, { cols: 80, rows: 24 }, true);

    expect(spawned).toHaveLength(2);
    expect(spawned[1].options.args).toEqual([
      '--resume',
      'conv-1',
      '--settings',
      '{"theme":"dark"}',
    ]);
  });

  it('uses the resolved Codex thread id when resuming', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      createdAt: '2026-06-04 06:45:36',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, false, 'Fix this');
    spawned[0].pty.emitExit({ exitCode: 0 });
    mocks.resolveCodexThreadIdForConversation.mockReturnValueOnce('codex-thread-1');

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, true);

    expect(mocks.resolveCodexThreadIdForConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: codexConversation.id,
        cwd: '/workspace',
        title: codexConversation.title,
        createdAt: codexConversation.createdAt,
        reservedThreadIds: new Set(),
      })
    );
    expect(mocks.ensureCodexThreadUnarchived).toHaveBeenCalledWith({
      runtimeId: 'codex',
      providerConfig: {
        cli: 'codex',
        resumeFlag: 'resume',
        resumeSessionIdArg: true,
        initialPromptFlag: '',
      },
      threadId: 'codex-thread-1',
      ctx: expect.anything(),
    });
    expect(mocks.ensureCodexResumeProviderCompatible).toHaveBeenCalledWith(
      'codex-thread-1',
      {
        cli: 'codex',
        resumeFlag: 'resume',
        resumeSessionIdArg: true,
        initialPromptFlag: '',
      },
      undefined
    );
    expect(mocks.resolveLocalPtySpawn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          tmuxSessionIdentity: 'codex-thread-1',
          tmuxSessionIdentityAliases: [codexConversation.id],
        }),
      })
    );
    expect(spawned).toHaveLength(2);
    expect(spawned[1].options.args).toEqual(['resume', '--cd', '/workspace', 'codex-thread-1']);
  });

  it('starts a fresh Codex session when the persisted thread is missing', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    mocks.resolveCodexThreadIdForConversation.mockReturnValueOnce(undefined);
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      createdAt: '2026-06-04 06:45:36',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, true);

    expect(spawned).toHaveLength(1);
    expect(spawned[0].options.args).toEqual([]);
    expect(mocks.ensureCodexResumeProviderCompatible).not.toHaveBeenCalled();
    expect(mocks.ensureCodexThreadUnarchived).not.toHaveBeenCalled();
    expect(mocks.aiLogStart).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ resuming: 'false' }),
      })
    );
    expect(mocks.startTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: codexConversation.id,
        isResuming: false,
        agentSessionId: undefined,
      })
    );
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'LocalConversationProvider: Codex thread is missing; starting a fresh session',
      {
        conversationId: codexConversation.id,
        cwd: '/workspace',
      }
    );
  });

  it('activates native Codex Plan mode before delivering the initial task', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      permissionMode: 'plan',
    };
    const provider = createProvider();

    await provider.startSession(
      codexConversation,
      { cols: 80, rows: 24 },
      false,
      'Inspect the repository and propose a plan'
    );

    expect(spawned[0].options.args).toEqual([
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'never',
    ]);
    expect(mocks.injectTuiStartupInput).toHaveBeenCalledWith({
      pty: spawned[0].pty,
      runtimeId: 'codex',
      input: '/plan Inspect the repository and propose a plan',
    });
  });

  it('resumes an adopted Codex session through its original account state root', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    const importedConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      sessionSource: {
        catalogId: 'catalog-1',
        runtimeId: 'codex',
        sessionId: 'native-thread-1',
        stateRoot: '/state/codex-account-a',
        providerId: 'provider-a',
      },
    };
    const provider = createProvider();

    await provider.startSession(importedConversation, { cols: 80, rows: 24 }, true);

    expect(mocks.reconcileCodexStateRoot).toHaveBeenCalledWith('/state/codex-account-a');
    expect(mocks.maybeAutoTrustCodexLocal).toHaveBeenCalledWith({
      runtimeId: 'codex',
      cwd: '/workspace',
      codexHome: '/state/codex-account-a',
    });
    expect(mocks.ensureCodexThreadUnarchived).toHaveBeenCalledWith({
      runtimeId: 'codex',
      providerConfig: {
        cli: 'codex',
        resumeFlag: 'resume',
        resumeSessionIdArg: true,
        initialPromptFlag: '',
        env: { CODEX_HOME: '/state/codex-account-a' },
      },
      threadId: 'native-thread-1',
      ctx: expect.anything(),
      statePath: '/state/codex-account-a/state_5.sqlite',
    });
    expect(mocks.repairCodexThreadHistoryProjection).toHaveBeenCalledWith({
      statePath: '/state/codex-account-a/state_5.sqlite',
      threadId: 'native-thread-1',
    });
    expect(mocks.repairCodexDuplicatedSessionMetaBoundary).toHaveBeenCalledWith({
      statePath: '/state/codex-account-a/state_5.sqlite',
      threadId: 'native-thread-1',
    });
    expect(mocks.buildAgentEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        providerVars: { CODEX_HOME: '/state/codex-account-a' },
      })
    );
    expect(spawned[0].options.args).toEqual(['resume', '--cd', '/workspace', 'native-thread-1']);
  });

  it('binds a surviving tmux session to the current Codex fork instead of its imported root', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/workspace', attachedClients: 0 },
    ]);
    mocks.resolveAgentResumeSessionId.mockReturnValue('current-fork-thread');
    const importedConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      sessionSource: {
        catalogId: 'catalog-1',
        runtimeId: 'codex',
        sessionId: 'stale-root-thread',
        stateRoot: '/state/codex-account-a',
      },
    };
    const provider = createProvider();

    await provider.startSession(importedConversation, { cols: 80, rows: 24 }, true);

    expect(spawned[0].options.args).toEqual([
      'resume',
      '--cd',
      '/workspace',
      'current-fork-thread',
    ]);
    expect(mocks.resolveLocalPtySpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          tmuxSessionName: 'tmux-session',
          tmuxSessionIdentity: 'current-fork-thread',
          tmuxSessionIdentityAliases: undefined,
        }),
      })
    );
  });

  it('injects Codex notify as a runtime config override when hooks are active', async () => {
    mocks.getHookPort.mockReturnValue(45123);
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(spawned[0].options.args[0]).toBe('-c');
    // The notify helper is bash -c on POSIX, powershell.exe -File on Windows.
    const notifyPrefix =
      process.platform === 'win32' ? 'notify=["powershell.exe"' : 'notify=["bash","-c"';
    expect(spawned[0].options.args[1]).toContain(notifyPrefix);
    // Notify reads the live hook endpoint at fire-time (survives restarts): the
    // bash helper inlines the hook-endpoint.json read; the .ps1 helper wraps it.
    if (process.platform === 'win32') {
      expect(spawned[0].options.args[1]).toContain('.ps1');
    } else {
      expect(spawned[0].options.args[1]).toContain('hook-endpoint.json');
    }
    expect(spawned[0].options.args[1]).not.toContain('YODA_HOOK_PORT');
    expect(spawned[0].options.args.slice(2)).toEqual(['Fix this']);
  });

  it('launches Codex against the selected MaaS provider with a process-scoped key', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
    });
    mocks.getRuntimeInferenceCredentials.mockResolvedValue({
      platformId: 'zenmux',
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.example.test/v1/',
      apiKey: 'zenmux-secret',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(spawned[0].options.args[0]).toBe('Fix this');
    expect(spawned[0].options.args.join(' ')).not.toContain('yoda-maas');
    expect(spawned[0].options.args).toEqual(
      expect.arrayContaining([
        'model_provider="zenmux"',
        'model_providers.zenmux.base_url="https://zenmux.example.test/v1"',
        'model_providers.zenmux.env_key="ZENMUX_API_KEY"',
        'model_catalog_json="/state/codex/.yoda/maas-model-catalog.json"',
      ])
    );
    expect(mocks.ensureCodexMaasCompatibleModelCatalog).toHaveBeenCalledWith(
      expect.stringMatching(/\.codex$/)
    );
    expect(spawned[0].options.args).not.toContain('zenmux-secret');
    expect(mocks.migrateLegacyCodexMaasHistory).toHaveBeenCalledWith(
      expect.objectContaining({ authProvider: 'yoda-maas', maasPlatformId: 'zenmux' })
    );
    expect(mocks.buildAgentEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        agentApiVars: false,
        providerVars: { ZENMUX_API_KEY: 'zenmux-secret' },
      })
    );
    expect(mocks.setInteractiveSessionContext).toHaveBeenCalledWith(
      codexConversation.id,
      expect.objectContaining({ maasEffective: true })
    );
    expect(mocks.aiLogStart).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ maasEffective: 'true' }),
      })
    );
  });

  it('maps a Codex model to the ZenMux catalog id without mixing in reasoning effort', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
      authProvider: 'yoda-maas',
      maasPlatformId: 'profile:zenmux',
    });
    mocks.getRuntimeInferenceCredentials.mockResolvedValue({
      platformId: 'profile:zenmux',
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'zenmux-secret',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
    };
    const provider = createProvider();

    await provider.startSession(
      codexConversation,
      { cols: 80, rows: 24 },
      false,
      'Fix this',
      undefined,
      undefined,
      { model: 'gpt-5.6-sol', reasoningEffort: 'high' }
    );

    const args = spawned[0].options.args;
    const modelIndex = args.indexOf('--model');
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(args[modelIndex + 1]).toBe('openai/gpt-5.6-sol');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).not.toContain('gpt-5.6-sol high');
  });

  it('removes every MaaS routing override after Codex is switched back', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
      authProvider: 'official-api',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(spawned[0].options.args).toEqual(['Fix this']);
    expect(mocks.getRuntimeInferenceCredentials).not.toHaveBeenCalled();
    expect(mocks.buildAgentEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        agentApiVars: [
          'CODEX_API_KEY',
          'OPENAI_API_KEY',
          'OPENAI_BASE_URL',
          'AZURE_OPENAI_API_KEY',
          'AZURE_OPENAI_API_ENDPOINT',
        ],
        providerVars: undefined,
      })
    );
  });

  it('passes an available tmux session name to the PTY spawn resolver', async () => {
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.resolveAvailableTmuxSessionName).toHaveBeenCalledWith({
      auto: false,
      ctx: expect.anything(),
      requested: false,
      sessionId,
      source: 'LocalConversationProvider',
    });
    expect(mocks.resolveLocalPtySpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          tmuxSessionName: 'tmux-session',
          tmuxSessionIdentity: conversation.id,
        }),
      })
    );
  });

  it('restarts a surviving tmux process after repairing its Codex history projection', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.repairCodexThreadHistoryProjection.mockReturnValue({
      status: 'repaired',
      byteOffset: 11_193_113,
      fromOrdinal: 1_305,
      toOrdinal: 1_304,
    });
    const provider = createProvider();

    await provider.startSession(
      { ...conversation, runtimeId: 'codex' },
      { cols: 80, rows: 24 },
      true
    );

    expect(mocks.killTmuxSession).toHaveBeenCalledWith(expect.anything(), 'tmux-session');
    expect(mocks.spawnLocalPty).toHaveBeenCalledOnce();
  });

  it('only attaches to a tmux pane proven to have survived startup hydration', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/workspace', attachedClients: 0 },
    ]);
    mocks.repairCodexThreadHistoryProjection.mockReturnValue({
      status: 'repaired',
      byteOffset: 11_193_113,
      fromOrdinal: 1_305,
      toOrdinal: 1_304,
    });
    const provider = createProvider();

    await provider.startSession(
      { ...conversation, runtimeId: 'codex' },
      { cols: 80, rows: 24 },
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { reattachExistingTmuxSession: true }
    );

    expect(mocks.reconcileCodexStateRoot).not.toHaveBeenCalled();
    expect(mocks.repairCodexThreadHistoryProjection).not.toHaveBeenCalled();
    expect(mocks.ensureCodexThreadUnarchived).not.toHaveBeenCalled();
    expect(mocks.killTmuxSession).not.toHaveBeenCalled();
    expect(mocks.resolveLocalPtySpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ tmuxReattachExistingSession: true }),
      })
    );
  });

  it('reports active and detachable agent session counts', async () => {
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    const provider = createProvider();

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(provider.getDetachableSessionCount()).toBe(0);

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(provider.getActiveSessionCount()).toBe(1);
    expect(provider.getDetachableSessionCount()).toBe(1);
    expect(provider.getActiveSessions()).toEqual([
      {
        sessionId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        pid: 4321,
        runtimeId: conversation.runtimeId,
        title: conversation.title,
        detachable: true,
      },
    ]);

    spawned[0].pty.emitExit({ exitCode: 0 });

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(provider.getDetachableSessionCount()).toBe(0);
    expect(provider.getActiveSessions()).toEqual([]);
  });

  it('sends input to an active PTY session', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    await expect(provider.sendInput(conversation.id, 'mobile follow-up')).resolves.toBe(true);
    expect(spawned[0].pty.writes).toEqual(['mobile follow-up']);
    expect(mocks.sendLiteralToTmuxSession).not.toHaveBeenCalled();
  });

  it('falls back to tmux when the active PTY is detached', async () => {
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    (
      provider as unknown as {
        sessions: Map<string, Pty>;
      }
    ).sessions.delete(sessionId);

    await expect(provider.sendInput(conversation.id, 'mobile follow-up')).resolves.toBe(true);
    expect(mocks.sendLiteralToTmuxSession).toHaveBeenCalledWith(
      expect.anything(),
      'tmux-session',
      'mobile follow-up'
    );
  });

  it('tracks runtime status separately from PTY presence', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      },
      'working'
    );
    expect(mocks.watchClaudeSessionActivity).toHaveBeenCalledWith(
      { conversationId: conversation.id, cwd: '/workspace', processPid: 4321 },
      expect.any(Function)
    );

    spawned[0].pty.emitExit({ exitCode: 0 });

    expect(mocks.dispatchRuntimeStatus).toHaveBeenCalledWith(
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      },
      expect.objectContaining({ kind: 'process-exited', at: expect.any(Number) }),
      'process-exited'
    );
    expect(mocks.removeRuntimeStatus).toHaveBeenCalledWith({
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    });
  });

  it('starts only the selected Claude transcript monitor', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'claude',
      statusMonitor: 'transcript',
    });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.watchClaudeRunState).toHaveBeenCalledOnce();
    expect(mocks.watchClaudeSessionActivity).not.toHaveBeenCalled();
    expect(mocks.wireAgentClassifier).not.toHaveBeenCalled();
  });

  it('keeps Codex approval classification alongside the rollout monitor', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'codex',
      statusMonitor: 'rollout',
      resumeFlag: 'resume',
      resumeSessionIdArg: true,
      initialPromptFlag: '',
    });
    const codexConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
    };
    const provider = createProvider();

    await provider.startSession(codexConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.watchCodexRunState).toHaveBeenCalledOnce();
    expect(mocks.wireAgentClassifier).toHaveBeenCalledOnce();
    expect(mocks.startTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Fix this',
      })
    );
  });

  it('records a pending Codex delivery attempt before spawning it', async () => {
    vi.setSystemTime(12_345);
    const pendingConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      pendingInitialPrompt: { prompt: 'Fix this' },
    };
    const provider = createProvider();

    await provider.startSession(pendingConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.recordPendingInitialPromptAttempt).toHaveBeenCalledWith(
      conversation.id,
      12_345,
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        stateRoot: expect.any(String),
        cwd: '/workspace',
      },
      undefined
    );
    expect(mocks.spawnLocalPty).toHaveBeenCalledOnce();
    expect(mocks.startTitle).toHaveBeenCalledWith(expect.objectContaining({ startedAtMs: 12_345 }));
  });

  it('does not spawn from a stale pending snapshot acknowledged during attempt recording', async () => {
    mocks.recordPendingInitialPromptAttempt.mockResolvedValueOnce(undefined);
    const pendingConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      pendingInitialPrompt: { prompt: 'Fix this' },
    };
    const provider = createProvider();

    await provider.startSession(pendingConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
    expect(mocks.startTitle).not.toHaveBeenCalled();
  });

  it('resumes an acknowledged native turn instead of replaying its pending prompt', async () => {
    mocks.findAcknowledgedCodexThreadForInitialPrompt.mockReturnValue({
      id: 'acknowledged-thread',
      cwd: '/workspace',
      title: 'Fix this',
      firstUserMessage: 'Fix this',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
    });
    const pendingConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      pendingInitialPrompt: {
        prompt: 'Fix this',
        attemptStartedAtMs: 5_000,
        attemptStateRoot: '/state/original-codex-home',
        attemptCwd: '/workspace',
      },
    };
    const provider = createProvider();

    await provider.startSession(pendingConversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.storeConversationSessionSource).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        sessionId: 'acknowledged-thread',
        stateRoot: '/state/original-codex-home',
      }),
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        expectedPendingAttemptStartedAtMs: 5_000,
      }
    );
    expect(mocks.findAcknowledgedCodexThreadForInitialPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        statePath: '/state/original-codex-home/state_5.sqlite',
        cwd: '/workspace',
      })
    );
    expect(mocks.recordPendingInitialPromptAttempt).not.toHaveBeenCalled();
    expect(mocks.startTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        isResuming: true,
        agentSessionId: 'acknowledged-thread',
        waitForInitialPrompt: false,
      })
    );
  });

  it('reconciles a surviving pending Codex pane against its original attempt window', async () => {
    vi.setSystemTime(12_345);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/workspace', attachedClients: 0 },
    ]);
    const pendingConversation: Conversation = {
      ...conversation,
      runtimeId: 'codex',
      pendingInitialPrompt: {
        prompt: 'Fix this',
        attemptStartedAtMs: 5_000,
        attemptStateRoot: '/state/original-codex-home',
      },
    };
    const provider = createProvider();

    await provider.startSession(
      pendingConversation,
      { cols: 80, rows: 24 },
      false,
      'Fix this',
      undefined,
      undefined,
      undefined,
      { reattachExistingTmuxSession: true }
    );

    expect(mocks.recordPendingInitialPromptAttempt).not.toHaveBeenCalled();
    expect(mocks.startTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAtMs: 5_000,
        stateRoot: '/state/original-codex-home',
      })
    );
  });

  it('auto-detects a surviving attempted-prompt pane before an ordinary resume can reset its window', async () => {
    vi.setSystemTime(12_345);
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/workspace', attachedClients: 0 },
    ]);
    const provider = createProvider();

    await provider.startSession(
      {
        ...conversation,
        runtimeId: 'codex',
        pendingInitialPrompt: { prompt: 'Fix this', attemptStartedAtMs: 5_000 },
      },
      { cols: 80, rows: 24 },
      false,
      'Fix this'
    );

    expect(mocks.recordPendingInitialPromptAttempt).not.toHaveBeenCalled();
    expect(mocks.resolveLocalPtySpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ tmuxReattachExistingSession: true }),
      })
    );
    expect(mocks.startTitle).toHaveBeenCalledWith(expect.objectContaining({ startedAtMs: 5_000 }));
  });

  it('leaves an attempted prompt intact when its sampled tmux pane vanished before attach', async () => {
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    const provider = createProvider();

    await expect(
      provider.startSession(
        {
          ...conversation,
          runtimeId: 'codex',
          pendingInitialPrompt: { prompt: 'Fix this', attemptStartedAtMs: 5_000 },
        },
        { cols: 80, rows: 24 },
        false,
        'Fix this',
        undefined,
        undefined,
        undefined,
        { reattachExistingTmuxSession: true }
      )
    ).rejects.toThrow('ended before it could be reattached');

    expect(mocks.recordPendingInitialPromptAttempt).not.toHaveBeenCalled();
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
  });

  it('does not commit a reattach whose pane disappears after PTY spawn', async () => {
    mocks.resolveAvailableTmuxSessionName.mockResolvedValue('tmux-session');
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([
      { sessionName: 'tmux-session', cwd: '/workspace', attachedClients: 0 },
    ]);
    mocks.waitForTmuxReattach.mockRejectedValueOnce(new Error('attach outcome missed'));
    const provider = createProvider();

    await expect(
      provider.startSession(
        {
          ...conversation,
          runtimeId: 'codex',
          pendingInitialPrompt: { prompt: 'Fix this', attemptStartedAtMs: 5_000 },
        },
        { cols: 80, rows: 24 },
        false,
        'Fix this',
        undefined,
        undefined,
        undefined,
        { reattachExistingTmuxSession: true }
      )
    ).rejects.toThrow('attach outcome missed');

    expect(provider.getActiveSessionCount()).toBe(0);
    expect(mocks.startTitle).not.toHaveBeenCalled();
    expect(mocks.recordPendingInitialPromptAttempt).not.toHaveBeenCalled();
    expect(spawned[0].pty.killCalls).toBe(1);
  });

  it('uses hooks alone when the selected hook monitor is available', async () => {
    mocks.getHookPort.mockReturnValue(43210);
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'claude',
      statusMonitor: 'hooks',
    });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.watchClaudeRunState).not.toHaveBeenCalled();
    expect(mocks.watchClaudeSessionActivity).not.toHaveBeenCalled();
    expect(mocks.wireAgentClassifier).not.toHaveBeenCalled();
  });

  it('falls back to terminal monitoring when selected hooks are unavailable', async () => {
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'claude',
      statusMonitor: 'hooks',
    });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');

    expect(mocks.wireAgentClassifier).toHaveBeenCalledOnce();
    expect(mocks.watchClaudeRunState).not.toHaveBeenCalled();
    expect(mocks.watchClaudeSessionActivity).not.toHaveBeenCalled();
  });

  it('marks sessions without an initial prompt as idle until the renderer reports work', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, true);

    expect(mocks.setRuntimeStatus).toHaveBeenCalledWith(
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      },
      'idle'
    );
  });

  it('cleans prepared Windows Claude settings after the PTY exits', async () => {
    const cleanup = vi.fn();
    mocks.prepareWindowsClaudeSettings.mockReturnValue({
      args: ['--settings', 'C:\\Temp Root\\settings.json'],
      cleanup,
    });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    expect(spawned[0].options.args).toEqual(['--settings', 'C:\\Temp Root\\settings.json']);

    spawned[0].pty.emitExit({ exitCode: 0 });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans prepared settings when spawning the PTY fails', async () => {
    const cleanup = vi.fn();
    mocks.prepareWindowsClaudeSettings.mockReturnValue({ args: [], cleanup });
    mocks.spawnLocalPty.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const provider = createProvider();

    await expect(
      provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this')
    ).rejects.toThrow('spawn failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.aiLogFinish).toHaveBeenCalledWith('ai-log-id', {
      status: 'failed',
      error: 'PTY spawn failed: Error: spawn failed',
    });
    expect(ptySessionRegistry.writeOrQueue(sessionId, 'late input')).toBe('unavailable');
  });

  it('cleans prepared settings when a session is stopped', async () => {
    const cleanup = vi.fn();
    mocks.prepareWindowsClaudeSettings.mockReturnValue({ args: [], cleanup });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    await provider.stopSession(conversation.id);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans prepared settings when all PTYs are detached', async () => {
    const cleanup = vi.fn();
    mocks.prepareWindowsClaudeSettings.mockReturnValue({ args: [], cleanup });
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    await provider.detachAll();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
