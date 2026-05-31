import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { LocalConversationProvider } from './local-conversation';

const mocks = vi.hoisted(() => ({
  appSettingsGet: vi.fn(),
  captureTelemetry: vi.fn(),
  emitEvent: vi.fn(),
  getHookPort: vi.fn(),
  getHookToken: vi.fn(),
  getProviderConfig: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  maybeAutoTrustLocal: vi.fn(),
  prepareHookConfig: vi.fn(),
  resolveLocalPtySpawn: vi.fn(),
  spawnLocalPty: vi.fn(),
  startTitle: vi.fn(),
  stopTitle: vi.fn(),
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

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustLocal: mocks.maybeAutoTrustLocal,
  },
}));

vi.mock('@main/core/agent-hooks/hook-config', () => ({
  HookConfigWriter: class {
    writeForProvider = mocks.prepareHookConfig;
  },
}));

vi.mock('@main/core/fs/impl/local-fs', () => ({
  LocalFileSystem: class {},
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: mocks.spawnLocalPty,
}));

vi.mock('@main/core/pty/pty-env', () => ({
  buildAgentEnv: () => ({}),
}));

vi.mock('@main/core/pty/pty-spawn-platform', () => ({
  logLocalPtySpawnWarnings: () => {},
  resolveLocalPtySpawn: mocks.resolveLocalPtySpawn,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession: vi.fn(),
  makeTmuxSessionName: (sessionId: string) => `tmux-${sessionId}`,
}));

vi.mock('@main/core/session-title/session-title-manager', () => ({
  sessionTitleManager: {
    start: mocks.startTitle,
    stop: mocks.stopTitle,
  },
}));

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
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
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  write(): void {}

  resize(): void {}

  kill(): void {}

  onData(): void {}

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
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
  providerId: 'claude',
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
    mocks.getProviderConfig.mockResolvedValue({
      cli: 'claude',
      resumeFlag: '--resume',
      autoApproveFlag: '--dangerously-skip-permissions',
      initialPromptFlag: '',
      sessionIdFlag: '--session-id',
    });
    mocks.appSettingsGet.mockResolvedValue({ writeAgentConfigToGitIgnore: false });
    mocks.maybeAutoTrustLocal.mockResolvedValue(undefined);
    mocks.prepareHookConfig.mockResolvedValue(undefined);
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
    vi.useRealTimers();
  });

  it('does not automatically respawn an agent session after exit', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].options.args).toEqual(['--session-id', 'conv-1', 'Fix this']);

    spawned[0].pty.emitExit({ exitCode: 0 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(spawned).toHaveLength(1);
  });

  it('uses provider resume arguments when explicitly resumed after exit', async () => {
    const provider = createProvider();

    await provider.startSession(conversation, { cols: 80, rows: 24 }, false, 'Fix this');
    spawned[0].pty.emitExit({ exitCode: 0 });

    await provider.startSession(conversation, { cols: 80, rows: 24 }, true);

    expect(spawned).toHaveLength(2);
    expect(spawned[1].options.args).toEqual(['--resume', 'conv-1']);
  });
});
