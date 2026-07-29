import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyDataChannel, ptyExitChannel } from '@shared/events/ptyEvents';
import { ptyController } from './controller';
import type { Pty, PtyExitInfo } from './pty';
import { ptySessionRegistry } from './pty-session-registry';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  loadHistory: vi.fn(),
  select: vi.fn(),
  resumeConversation: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

vi.mock('@main/core/conversations/codex-rollout-terminal-history', () => ({
  loadCodexRolloutTerminalHistoryForConversation: mocks.loadHistory,
}));

vi.mock('@main/core/conversations/utils', () => ({
  mapConversationRowToConversation: vi.fn(() => ({
    id: 'conversation',
    runtimeId: 'codex',
  })),
}));

vi.mock('@main/core/conversations/resumeConversation', () => ({
  resumeConversation: mocks.resumeConversation,
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    getTask: vi.fn(),
    getWorkspaceId: vi.fn(() => undefined),
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('@main/db/schema', () => ({
  conversations: {
    id: {},
    projectId: {},
    taskId: {},
  },
  projects: {
    id: {},
    path: {},
    workspaceProvider: {},
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

class FakePty implements Pty {
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((info: PtyExitInfo) => void) | null = null;

  write(): void {}

  resize(): void {}

  kill(): void {}

  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandler = handler;
  }

  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  emitExit(info: PtyExitInfo): void {
    this.exitHandler?.(info);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mockConversationLookup(): void {
  mocks.select.mockImplementation(() => {
    const chain = {
      innerJoin: () => chain,
      where: () => chain,
      limit: () =>
        Promise.resolve([
          {
            conversation: { id: 'conversation' },
            projectPath: '/workspace',
            projectWorkspaceProvider: 'local',
          },
        ]),
    };
    return { from: () => chain };
  });
}

describe('ptyController.subscribe history handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationLookup();
  });

  it('returns the new live snapshot when a PTY registers during history loading', async () => {
    const sessionId = 'project-live:task-live:conversation-live';
    const consumerId = 'consumer-live';
    const history = deferred<string>();
    const historyStarted = deferred<void>();
    mocks.loadHistory.mockImplementation(() => {
      historyStarted.resolve();
      return history.promise;
    });

    const resultPromise = ptyController.subscribe(sessionId, consumerId);
    await historyStarted.promise;

    const pty = new FakePty();
    ptySessionRegistry.register(sessionId, pty);
    pty.emitData('live output');
    history.resolve('stale history');

    await expect(resultPromise).resolves.toEqual({
      success: true,
      data: {
        buffer: 'live output',
        generation: 1,
        sequence: 1,
      },
    });
    expect(mocks.emit.mock.calls.filter(([channel]) => channel === ptyDataChannel)).toHaveLength(1);

    ptySessionRegistry.unregister(sessionId);
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });

  it('returns the latest tombstone and discards history after register plus exit', async () => {
    const sessionId = 'project-exit:task-exit:conversation-exit';
    const consumerId = 'consumer-exit';
    const history = deferred<string>();
    const historyStarted = deferred<void>();
    mocks.loadHistory.mockImplementation(() => {
      historyStarted.resolve();
      return history.promise;
    });

    const resultPromise = ptyController.subscribe(sessionId, consumerId);
    await historyStarted.promise;

    const pty = new FakePty();
    ptySessionRegistry.register(sessionId, pty);
    pty.emitData('final output');
    pty.emitExit({ exitCode: 0, signal: 'SIGTERM' });
    history.resolve('stale history');

    await expect(resultPromise).resolves.toEqual({
      success: true,
      data: {
        buffer: '',
        generation: 1,
        sequence: 0,
      },
    });
    expect(mocks.emit.mock.calls.filter(([channel]) => channel === ptyDataChannel)).toHaveLength(1);
    expect(mocks.emit.mock.calls.filter(([channel]) => channel === ptyExitChannel)).toHaveLength(1);

    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });
});

describe('ptyController.sendInput registration gate', () => {
  it('queues the first input and transparently resumes a cold agent session', () => {
    mocks.resumeConversation.mockResolvedValue(undefined);
    const sessionId = 'project-none:task-none:conversation-none';
    expect(ptyController.sendInput(sessionId, 'input')).toEqual({
      success: true,
      data: { queued: true },
    });
    expect(mocks.resumeConversation).toHaveBeenCalledWith(
      'project-none',
      'task-none',
      'conversation-none'
    );
    const epoch = ptySessionRegistry.beginRegistration(sessionId);
    ptySessionRegistry.cancelRegistration(sessionId, epoch);
  });

  it('accepts optimistic input during an explicit registration epoch', () => {
    const sessionId = 'project-pending:task-pending:conversation-pending';
    const epoch = ptySessionRegistry.beginRegistration(sessionId);

    expect(ptyController.sendInput(sessionId, 'input')).toEqual({
      success: true,
      data: { queued: true },
    });

    ptySessionRegistry.cancelRegistration(sessionId, epoch);
  });
});
