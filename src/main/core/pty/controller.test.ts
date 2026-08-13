import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { ptyController } from './controller';
import type { Pty, PtyExitInfo } from './pty';
import {
  PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES,
  PTY_OUTPUT_BATCH_MAX_BYTES,
  ptySessionRegistry,
} from './pty-session-registry';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getActiveSessions: vi.fn(),
  getTask: vi.fn(),
  resumeConversation: vi.fn(),
  sendProviderInput: vi.fn(),
}));

vi.mock('@main/core/conversations/resumeConversation', () => ({
  resumeConversation: mocks.resumeConversation,
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    getTask: mocks.getTask,
    getWorkspaceId: vi.fn(() => undefined),
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: vi.fn(),
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
  readonly pause = vi.fn();
  readonly resume = vi.fn();
  readonly resize = vi.fn<(cols: number, rows: number) => void | boolean>();
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((info: PtyExitInfo) => void) | null = null;

  write(): void {}

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

function createFakeWebContents(id: number): {
  sender: WebContents;
  emit: (eventName: string) => void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const sender = {
    id,
    isDestroyed: vi.fn(() => false),
    on: vi.fn((eventName: string, listener: () => void) => {
      const handlers = listeners.get(eventName) ?? new Set();
      handlers.add(listener);
      listeners.set(eventName, handlers);
      return sender;
    }),
  } as unknown as WebContents;
  return {
    sender,
    emit: (eventName) => {
      for (const listener of listeners.get(eventName) ?? []) listener();
    },
  };
}

function registerPtyInvokeHandlers(): Map<
  string,
  (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
  } as unknown as IpcMain;
  registerRPCRouter({ pty: ptyController }, ipcMain);
  return handlers;
}

describe('ptyController.subscribe terminal snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the exact live PTY snapshot as the only terminal source', async () => {
    const sessionId = 'project-interrupted:task-interrupted:conversation-interrupted';
    const consumerId = 'consumer-interrupted';

    const pty = new FakePty();
    ptySessionRegistry.register(sessionId, pty);
    const liveTerminalBuffer =
      '\x1b[38;5;1m■ Conversation interrupted - tell the model what to do differently. ' +
      'Something went wrong? Hit `/feedback` to report the issue.\x1b[39m\n' +
      '\x1b[2K› Improve documentation in @filename';
    pty.emitData(liveTerminalBuffer);

    await expect(ptyController.subscribe(sessionId, consumerId)).resolves.toEqual({
      success: true,
      data: {
        buffer: liveTerminalBuffer,
        generation: 1,
        sequence: 0,
      },
    });

    ptySessionRegistry.unregister(sessionId);
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });

  it('returns an empty terminal snapshot while a PTY generation is registering', async () => {
    const sessionId = 'project-restoring:task-restoring:conversation-restoring';
    const consumerId = 'consumer-restoring';
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);

    await expect(ptyController.subscribe(sessionId, consumerId)).resolves.toEqual({
      success: true,
      data: {
        buffer: '',
        generation: 0,
        sequence: 0,
      },
    });

    ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });

  it('returns an empty terminal snapshot for a fully offline session instead of transcript text', async () => {
    const sessionId = 'project-offline:task-offline:conversation-offline';
    const consumerId = 'consumer-offline';

    await expect(ptyController.subscribe(sessionId, consumerId)).resolves.toEqual({
      success: true,
      data: {
        buffer: '',
        generation: 0,
        sequence: 0,
      },
    });

    ptySessionRegistry.unsubscribe(sessionId, consumerId);
  });
});

describe('ptyController.subscribe WebContents ownership', () => {
  it('releases a crashed renderer consumer and flow control in the same turn', async () => {
    const sessionId = 'project-owner:task-owner:conversation-owner';
    const pty = new FakePty();
    const crashedOwner = createFakeWebContents(41);
    const liveOwner = createFakeWebContents(42);
    const invokeHandlers = registerPtyInvokeHandlers();
    const subscribe = invokeHandlers.get('pty.subscribe');
    if (!subscribe) throw new Error('pty.subscribe RPC was not registered');

    ptySessionRegistry.register(sessionId, pty);
    await subscribe(
      { sender: crashedOwner.sender } as IpcMainInvokeEvent,
      sessionId,
      'crashed-consumer'
    );
    await subscribe({ sender: liveOwner.sender } as IpcMainInvokeEvent, sessionId, 'live-consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    const finalSequence = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;
    ptyController.acknowledgeOutput(sessionId, 'live-consumer', 1, finalSequence);
    expect(pty.pause).toHaveBeenCalledTimes(1);
    expect(pty.resume).not.toHaveBeenCalled();

    crashedOwner.emit('render-process-gone');

    expect(pty.resume).toHaveBeenCalledTimes(1);
    expect(ptySessionRegistry.getDiagnostics(sessionId)?.consumerCount).toBe(1);

    liveOwner.emit('destroyed');
    ptySessionRegistry.unregister(sessionId);
  });

  it('releases an exact-generation reveal claim when its renderer crashes', async () => {
    const sessionId = 'project-claim-owner:task-claim-owner:conversation-claim-owner';
    const owner = createFakeWebContents(51);
    const invokeHandlers = registerPtyInvokeHandlers();
    const subscribe = invokeHandlers.get('pty.subscribe');
    const claim = invokeHandlers.get('pty.claimGenerationReveal');
    if (!subscribe || !claim) throw new Error('PTY owner RPCs were not registered');

    ptySessionRegistry.register(sessionId, new FakePty());
    await subscribe({ sender: owner.sender } as IpcMainInvokeEvent, sessionId, 'renderer');
    expect(
      claim({ sender: owner.sender } as IpcMainInvokeEvent, sessionId, 'renderer', 1)
    ).toMatchObject({ success: true, data: { generation: 1 } });

    const replacementEpoch = ptySessionRegistry.beginRegistration(sessionId);
    const replacementFence = ptySessionRegistry.waitForRevealClaims(sessionId, replacementEpoch);
    owner.emit('render-process-gone');

    await expect(replacementFence).resolves.toBe(true);
    expect(ptySessionRegistry.getDiagnostics(sessionId)?.consumerCount).toBe(0);
    ptySessionRegistry.cancelRegistration(sessionId, replacementEpoch);
    ptySessionRegistry.unregister(sessionId);
  });
});

describe('ptyController.sendInput registration gate', () => {
  beforeEach(() => {
    mocks.resumeConversation.mockClear();
    mocks.getActiveSessions.mockReturnValue([]);
    mocks.getTask.mockReturnValue(undefined);
    mocks.sendProviderInput.mockResolvedValue(false);
  });

  it('queues the first input and transparently resumes a cold agent session', async () => {
    mocks.resumeConversation.mockResolvedValue(undefined);
    const sessionId = 'project-none:task-none:conversation-none';
    await expect(ptyController.sendInput(sessionId, 'input')).resolves.toEqual({
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

  it('accepts optimistic input during an explicit registration epoch', async () => {
    const sessionId = 'project-pending:task-pending:conversation-pending';
    const epoch = ptySessionRegistry.beginRegistration(sessionId);

    await expect(ptyController.sendInput(sessionId, 'input')).resolves.toEqual({
      success: true,
      data: { queued: true },
    });

    ptySessionRegistry.cancelRegistration(sessionId, epoch);
  });

  it('delivers input directly to a detached tmux pane without attaching a headless PTY', async () => {
    mocks.getTask.mockReturnValue({
      conversations: {
        getActiveSessions: mocks.getActiveSessions,
        sendInput: mocks.sendProviderInput,
      },
    });
    mocks.getActiveSessions.mockReturnValue([
      {
        conversationId: 'conversation-detached',
        detachable: true,
        transportAttached: false,
      },
    ]);
    mocks.sendProviderInput.mockResolvedValue(true);

    await expect(
      ptyController.sendInput('project-detached:task-detached:conversation-detached', 'follow-up')
    ).resolves.toEqual({ success: true, data: { queued: false } });

    expect(mocks.sendProviderInput).toHaveBeenCalledWith('conversation-detached', 'follow-up');
    expect(mocks.resumeConversation).not.toHaveBeenCalled();
  });
});

describe('ptyController.getSessionState', () => {
  it('reports the current generation plus live and registering ownership', () => {
    const sessionId = 'project-state:task-state:conversation-state';
    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);

    expect(ptyController.getSessionState(sessionId)).toEqual({
      generation: 0,
      live: false,
      registering: true,
    });

    ptySessionRegistry.register(sessionId, new FakePty(), { registrationEpoch });

    expect(ptyController.getSessionState(sessionId)).toEqual({
      generation: 1,
      live: true,
      registering: false,
    });

    ptySessionRegistry.unregister(sessionId);

    expect(ptyController.getSessionState(sessionId)).toEqual({
      generation: 1,
      live: false,
      registering: false,
    });
  });
});

describe('ptyController.resize', () => {
  it('reports backend resize failure from the legacy endpoint', () => {
    const sessionId = 'project-resize:task-resize:conversation-resize';
    const pty = new FakePty();
    pty.resize.mockReturnValue(false);
    ptySessionRegistry.register(sessionId, pty);

    expect(ptyController.resize(sessionId, 120, 30)).toEqual({
      success: false,
      error: { type: 'resize_failed' },
    });

    ptySessionRegistry.unregister(sessionId);
  });

  it('resizes only the expected live generation', () => {
    const sessionId = 'project-owned-resize:task-owned-resize:conversation-owned-resize';
    const pty = new FakePty();
    ptySessionRegistry.register(sessionId, pty);

    expect(ptyController.resizeForRenderer(sessionId, 0, 120, 30)).toEqual({
      success: false,
      error: { type: 'generation_mismatch' },
    });
    expect(pty.resize).not.toHaveBeenCalled();
    expect(ptyController.resizeForRenderer(sessionId, 1, 120, 30)).toEqual({
      success: true,
      data: { generation: 1, changed: true },
    });
    expect(pty.resize).toHaveBeenCalledWith(120, 30);

    ptySessionRegistry.unregister(sessionId);
  });

  it('distinguishes missing sessions from a live backend resize failure', () => {
    const sessionId = 'project-failed-resize:task-failed-resize:conversation-failed-resize';

    expect(ptyController.resizeForRenderer(sessionId, 1, 120, 30)).toEqual({
      success: false,
      error: { type: 'not_found' },
    });

    const pty = new FakePty();
    pty.resize.mockReturnValue(false);
    ptySessionRegistry.register(sessionId, pty);
    expect(ptyController.resizeForRenderer(sessionId, 1, 120, 30)).toEqual({
      success: false,
      error: { type: 'resize_failed' },
    });

    ptySessionRegistry.unregister(sessionId);
  });
});
