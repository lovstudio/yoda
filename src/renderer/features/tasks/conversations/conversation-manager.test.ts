import { autorun } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
} from '@shared/events/agentEvents';
import {
  conversationArchivedChannel,
  conversationMovedChannel,
  conversationRenamedChannel,
} from '@shared/events/conversationEvents';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import { ConversationManagerStore } from './conversation-manager';

const mocks = vi.hoisted(() => ({
  eventEmitMock: vi.fn(),
  eventOnMock: vi.fn(),
  expectCanonicalGenerationMock: vi.fn(),
  expectCanonicalSurfaceAnchorMock: vi.fn(),
  acquireCanonicalRevealClaimMock: vi.fn(),
  releaseCanonicalRevealClaimMock: vi.fn(),
  ptyConnectMock: vi.fn(),
  ptyDiscardUnconnectedRendererMock: vi.fn(),
  ptyDisposeMock: vi.fn(),
  ptyPrepareFirstFrameMock: vi.fn(),
  ptyReconnectMock: vi.fn(),
  ptyResizeMock: vi.fn(),
  resizeForRendererMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  createConversationMock: vi.fn(),
  forkConversationMock: vi.fn(),
  forkConversationAtPromptMock: vi.fn(),
  getConversationSessionInfoMock: vi.fn(),
  getConversationRuntimeStatusesMock: vi.fn(),
  getConversationsForTaskMock: vi.fn(),
  getSessionStateMock: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
  resumeConversationMock: vi.fn(),
  restartConversationMock: vi.fn(),
  soundPlayMock: vi.fn(),
  touchConversationMock: vi.fn(),
  getPaneContainerMock: vi.fn(),
  getCellMetricsMock: vi.fn(),
  getTerminalFitScrollbarWidthMock: vi.fn(),
  measureDimensionsMock: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    emit: mocks.eventEmitMock,
    on: mocks.eventOnMock,
  },
  rpc: {
    conversations: {
      archiveConversation: mocks.archiveConversationMock,
      createConversation: mocks.createConversationMock,
      forkConversation: mocks.forkConversationMock,
      forkConversationAtPrompt: mocks.forkConversationAtPromptMock,
      getConversationSessionInfo: mocks.getConversationSessionInfoMock,
      getConversationRuntimeStatuses: mocks.getConversationRuntimeStatusesMock,
      getConversationsForTask: mocks.getConversationsForTaskMock,
      resumeConversation: mocks.resumeConversationMock,
      restartConversation: mocks.restartConversationMock,
      touchConversation: mocks.touchConversationMock,
    },
    pty: {
      getSessionState: mocks.getSessionStateMock,
      resize: mocks.ptyResizeMock,
      resizeForRenderer: mocks.resizeForRendererMock,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = mocks.ptyConnectMock;
    discardUnconnectedRenderer = mocks.ptyDiscardUnconnectedRendererMock;
    reconnect = mocks.ptyReconnectMock;
    dispose = mocks.ptyDisposeMock;
    prepareFirstFrame = mocks.ptyPrepareFirstFrameMock;
  },
}));

vi.mock('@renderer/lib/pty/pane-sizing-context', () => ({
  getPaneContainer: mocks.getPaneContainerMock,
}));

vi.mock('@renderer/lib/pty/pty-dimensions', () => ({
  getCellMetrics: mocks.getCellMetricsMock,
  getTerminalFitScrollbarWidth: mocks.getTerminalFitScrollbarWidthMock,
  measureDimensions: mocks.measureDimensionsMock,
  TERMINAL_FIT_GUARD_COLUMNS: 2,
}));

vi.mock('@renderer/utils/soundPlayer', () => ({
  soundPlayer: {
    play: mocks.soundPlayMock,
  },
}));

const conversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'claude',
  title: 'Claude',
  lastInteractedAt: '2026-05-01T00:00:00.000Z',
  isInitialConversation: true,
};
const STAGING_CANCELLATION_POLL_MS_FOR_TEST = 25;

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('ConversationManagerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.eventOnMock.mockImplementation((event: { name: string }, cb: (data: unknown) => void) => {
      mocks.listeners.set(event.name, cb);
      return vi.fn();
    });
    mocks.resumeConversationMock.mockResolvedValue({ running: true, generation: 1 });
    mocks.restartConversationMock.mockResolvedValue({ generation: 1 });
    mocks.archiveConversationMock.mockResolvedValue(undefined);
    mocks.createConversationMock.mockResolvedValue(conversation);
    mocks.forkConversationMock.mockResolvedValue({
      ...conversation,
      id: 'conversation-fork',
      title: 'Claude · #1',
      isInitialConversation: false,
      forkedFromConversationId: 'conversation-1',
      forkedFromPromptIndex: 0,
    });
    mocks.forkConversationAtPromptMock.mockResolvedValue({
      ...conversation,
      id: 'conversation-fork',
      title: 'Claude · #1',
      isInitialConversation: false,
      forkedFromConversationId: 'conversation-1',
      forkedFromPromptIndex: 0,
    });
    mocks.touchConversationMock.mockResolvedValue(undefined);
    mocks.getConversationSessionInfoMock.mockResolvedValue({ running: false });
    mocks.getConversationRuntimeStatusesMock.mockResolvedValue({});
    mocks.getConversationsForTaskMock.mockResolvedValue([]);
    mocks.getSessionStateMock.mockResolvedValue({
      generation: 1,
      live: false,
      registering: false,
    });
    mocks.ptyConnectMock.mockResolvedValue(undefined);
    mocks.resizeForRendererMock.mockImplementation((_sessionId: string, generation: number) =>
      Promise.resolve({
        success: true,
        data: { generation, changed: true },
      })
    );
    mocks.ptyPrepareFirstFrameMock.mockResolvedValue(true);
    mocks.acquireCanonicalRevealClaimMock.mockResolvedValue(true);
    mocks.expectCanonicalGenerationMock.mockImplementation(function (
      this: { canonicalGeneration?: number },
      generation: number
    ) {
      this.canonicalGeneration = generation;
    });
    mocks.expectCanonicalSurfaceAnchorMock.mockImplementation(function (
      this: { canonicalGeneration?: number },
      generation: number
    ) {
      this.canonicalGeneration = generation;
    });
    mocks.getPaneContainerMock.mockReturnValue({ id: 'conversations-pane' });
    mocks.getCellMetricsMock.mockReturnValue({ width: 8, height: 16 });
    mocks.getTerminalFitScrollbarWidthMock.mockReturnValue(10);
    mocks.measureDimensionsMock.mockReturnValue({ cols: 144, rows: 45 });
  });

  it('does not eagerly connect a preloaded historical conversation PTY', () => {
    new ConversationManagerStore('project-1', 'task-1', [conversation]);

    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();
  });

  it('treats an empty preload as loaded when conversations become observed', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', []);
    const stopObserving = autorun(() => store.conversations.size);

    await flushPromises();

    expect(mocks.getConversationsForTaskMock).not.toHaveBeenCalled();
    expect(store.hasAuthoritativeSnapshot).toBe(true);
    stopObserving();
    store.dispose();
  });

  it('does not expose an empty manager as an authoritative snapshot while loading', async () => {
    let resolveConversations: ((conversations: Conversation[]) => void) | undefined;
    mocks.getConversationsForTaskMock.mockImplementation(
      () =>
        new Promise<Conversation[]>((resolve) => {
          resolveConversations = resolve;
        })
    );
    const store = new ConversationManagerStore('project-1', 'task-1');
    const load = store.load();

    expect(store.hasAuthoritativeSnapshot).toBe(false);
    resolveConversations?.([conversation]);
    await load;

    expect(store.hasAuthoritativeSnapshot).toBe(true);
    expect(store.conversations.has(conversation.id)).toBe(true);
    store.dispose();
  });

  it('exposes a failed snapshot load and retries it without a new observation', async () => {
    const failure = new Error('conversation snapshot unavailable');
    mocks.getConversationsForTaskMock
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([conversation]);
    const store = new ConversationManagerStore('project-1', 'task-1');

    await expect(store.load()).rejects.toBe(failure);

    expect(store.hasAuthoritativeSnapshot).toBe(false);
    expect(store.loadError).toBe(failure);

    await expect(store.retryLoad()).resolves.toBeUndefined();

    expect(mocks.getConversationsForTaskMock).toHaveBeenCalledTimes(2);
    expect(store.loadError).toBeNull();
    expect(store.hasAuthoritativeSnapshot).toBe(true);
    expect(store.conversations.has(conversation.id)).toBe(true);
    store.dispose();
  });

  it('times out one hung snapshot request and waits for an explicit retry', async () => {
    vi.useFakeTimers();
    try {
      mocks.getConversationsForTaskMock
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce([conversation]);
      const store = new ConversationManagerStore('project-1', 'task-1');
      const load = store.load();
      const rejected = expect(load).rejects.toThrow('Conversation snapshot load exceeded');

      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;

      expect(mocks.getConversationsForTaskMock).toHaveBeenCalledOnce();
      expect(store.hasAuthoritativeSnapshot).toBe(false);
      expect(store.loadError).toBeInstanceOf(Error);

      await expect(store.retryLoad()).resolves.toBeUndefined();
      expect(mocks.getConversationsForTaskMock).toHaveBeenCalledTimes(2);
      expect(store.loadError).toBeNull();
      expect(store.hasAuthoritativeSnapshot).toBe(true);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates user prompt timestamps to the owning task', async () => {
    const onUserPromptAt = vi.fn();
    const store = new ConversationManagerStore(
      'project-1',
      'task-1',
      [conversation],
      onUserPromptAt
    );

    await store.touchConversation('conversation-1');

    const [, lastInteractedAt] = mocks.touchConversationMock.mock.calls[0]!;
    expect(store.conversations.get('conversation-1')?.data.lastInteractedAt).toBe(lastInteractedAt);
    expect(onUserPromptAt).toHaveBeenCalledWith(lastInteractedAt);
  });

  it('can force a permission prompt back to working after user approval', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');

    item?.setAwaitingInput('permission_prompt');
    item?.setWorking();
    expect(item?.status).toBe('awaiting-input');

    item?.setWorking({ force: true });
    expect(item?.status).toBe('working');
    expect(mocks.eventEmitMock).toHaveBeenLastCalledWith(agentSessionStatusChangedChannel, {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'working',
      providerTurnConfirmed: false,
    });
  });

  it('keeps awaiting-input visible after the active conversation is marked seen', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');

    item?.setAwaitingInput('elicitation_dialog');
    item?.markSeen();

    expect(item?.indicatorStatus).toBe('awaiting-input');
    expect(store.taskStatus).toBe('awaiting-input');
  });

  it('mirrors awaiting-input context to the main-process runtime authority', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');

    item?.setAwaitingInput('permission_prompt', { actionDescription: 'Allow this command?' });

    expect(mocks.eventEmitMock).toHaveBeenLastCalledWith(agentSessionStatusChangedChannel, {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'awaiting-input',
      providerTurnConfirmed: false,
      pendingAction: {
        notificationType: 'permission_prompt',
        actionDescription: 'Allow this command?',
      },
    });
  });

  it('prioritizes awaiting-input over another working conversation', () => {
    const workingConversation: Conversation = {
      ...conversation,
      id: 'conversation-2',
      title: 'Codex',
      runtimeId: 'codex',
    };
    const store = new ConversationManagerStore('project-1', 'task-1', [
      conversation,
      workingConversation,
    ]);

    const awaiting = store.conversations.get('conversation-1');
    const working = store.conversations.get('conversation-2');
    working?.setWorking();
    awaiting?.setAwaitingInput('elicitation_dialog');
    awaiting?.markSeen();

    expect(store.taskStatus).toBe('awaiting-input');
  });

  it('applies authoritative awaiting-input status with pending action context', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const listener = mocks.listeners.get(agentSessionStatusChangedChannel.name);

    listener?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'awaiting-input',
      pendingAction: {
        notificationType: 'elicitation_dialog',
        toolName: 'AskUserQuestion',
        actionDescription: 'Pick an option',
      },
    });

    const item = store.conversations.get('conversation-1');
    expect(item?.status).toBe('awaiting-input');
    expect(item?.lastNotificationType).toBe('elicitation_dialog');
    expect(item?.pendingActionDescription).toBe('Pick an option');
    expect(store.taskStatus).toBe('awaiting-input');
    expect(mocks.eventEmitMock).not.toHaveBeenCalledWith(agentSessionStatusChangedChannel, {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'awaiting-input',
    });
  });

  it('promotes the provider fence when an authoritative turn-start keeps working status', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setWorking({ force: true });
    mocks.eventEmitMock.mockClear();
    const listener = mocks.listeners.get(agentSessionStatusChangedChannel.name);

    listener?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'working',
      providerTurnConfirmed: true,
    });

    expect(item?.status).toBe('working');
    expect(item?.providerTurnConfirmed).toBe(true);
    expect(mocks.eventEmitMock).not.toHaveBeenCalled();
  });

  it('resets and republishes the provider fence for a new optimistic working turn', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.applyAuthoritativeStatus('working', null, true);
    mocks.eventEmitMock.mockClear();

    item?.setWorking({ force: true });

    expect(item?.status).toBe('working');
    expect(item?.providerTurnConfirmed).toBe(false);
    expect(mocks.eventEmitMock).toHaveBeenCalledWith(agentSessionStatusChangedChannel, {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'working',
      providerTurnConfirmed: false,
    });
  });

  it('passes current terminal size when resuming and reapplies it after spawn', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await expect(store.resumeConversation('conversation-1', { cols: 132, rows: 37 })).resolves.toBe(
      true
    );

    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 132, rows: 37 }
    );
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 132, 37);
  });

  it('waits for a stopped resume generation before staging its canonical first frame', async () => {
    let finishResume!: (result: { running: boolean; generation: number }) => void;
    mocks.resumeConversationMock.mockImplementationOnce(
      () =>
        new Promise<{ running: boolean; generation: number }>((resolve) => {
          finishResume = resolve;
        })
    );
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const shouldContinue = vi.fn(() => true);
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: null,
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    const opening = store.prepareConversationForOpen('conversation-1', shouldContinue, 900);

    await vi.waitFor(() => expect(mocks.resumeConversationMock).toHaveBeenCalledOnce());
    expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
    finishResume({ running: true, generation: 2 });
    await expect(opening).resolves.toBe(true);

    expect(mocks.ptyConnectMock).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionStateMock).toHaveBeenCalledWith('project-1:task-1:conversation-1');
    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 144, rows: 45 }
    );
    expect(mocks.resizeForRendererMock).toHaveBeenCalledWith(
      'project-1:task-1:conversation-1',
      2,
      144,
      45
    );
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledWith(
      { cols: 144, rows: 45 },
      expect.any(Function),
      { waitForCanonicalOutput: true, timeoutMs: expect.any(Number) }
    );
    expect(mocks.resizeForRendererMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ptyPrepareFirstFrameMock.mock.invocationCallOrder[0]
    );
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(2);
    expect(mocks.getPaneContainerMock).toHaveBeenCalledWith('conversations:project-1:task-1');
    expect(mocks.measureDimensionsMock).toHaveBeenCalledWith(
      { id: 'conversations-pane' },
      8,
      16,
      10,
      2
    );
  });

  it('keeps the transcript renderer when staging finds an external writer', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce({
      running: false,
      generation: 1,
      reason: 'external-writer',
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: null,
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      'external-writer'
    );

    expect(item?.sessionResumeBlockReason).toBe('external-writer');
    expect(item?.sessionExited).toBe(false);
    expect(mocks.ptyDiscardUnconnectedRendererMock).not.toHaveBeenCalled();
    expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
  });

  it('discards a renderer created for a task open cancelled before subscription', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const preparedPty = {
      acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
      lastSentDims: null,
      terminal: { cols: 80, rows: 24 },
    } as unknown as FrontendPty;
    let keepOpening = true;
    mocks.ptyConnectMock.mockImplementationOnce(() => {
      if (item) item.session.pty = preparedPty;
      keepOpening = false;
      return Promise.resolve();
    });

    await expect(
      store.prepareConversationForOpen('conversation-1', () => keepOpening, 900)
    ).resolves.toBe(false);

    expect(mocks.ptyDiscardUnconnectedRendererMock).toHaveBeenCalledWith(preparedPty);
    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
    expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
  });

  it('stages an already-live PTY without entering the resume controller', async () => {
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const shouldContinue = vi.fn(() => true);
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(
      store.prepareConversationForOpen('conversation-1', shouldContinue, 900)
    ).resolves.toBe(true);

    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(7);
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledWith(
      { cols: 144, rows: 45 },
      expect.any(Function),
      { waitForCanonicalOutput: true, timeoutMs: expect.any(Number) }
    );
    expect(mocks.resizeForRendererMock).toHaveBeenCalledWith(
      'project-1:task-1:conversation-1',
      7,
      144,
      45
    );
    expect(mocks.ptyResizeMock).not.toHaveBeenCalled();
  });

  it('binds a bounded transcript anchor before staging an already-live cold Codex PTY', async () => {
    const surfaceAnchor = {
      kind: 'anchor' as const,
      segments: ['latest final assistant tail'],
    };
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    mocks.resumeConversationMock.mockResolvedValueOnce({
      running: true,
      generation: 7,
      surfaceAnchor,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [
      { ...conversation, runtimeId: 'codex' },
    ]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        expectCanonicalSurfaceAnchor: mocks.expectCanonicalSurfaceAnchorMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 144, rows: 45 }
    );
    expect(mocks.expectCanonicalSurfaceAnchorMock).toHaveBeenCalledWith(7, surfaceAnchor);
    expect(mocks.expectCanonicalSurfaceAnchorMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ptyPrepareFirstFrameMock.mock.invocationCallOrder[0]
    );
  });

  it('hands browser-paint readiness to the mounted session after claiming the staged generation', async () => {
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );
    expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Number),
      { requireMountedFramePaint: true }
    );
    expect(mocks.acquireCanonicalRevealClaimMock.mock.calls[0]?.[1]).toBeLessThanOrEqual(250);
    expect(mocks.ptyPrepareFirstFrameMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireCanonicalRevealClaimMock.mock.invocationCallOrder[0]
    );
  });

  it('defers a same-generation claim miss to the mounted visible-frame retry loop', async () => {
    mocks.getSessionStateMock
      .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
      .mockResolvedValueOnce({ generation: 7, live: true, registering: false });
    mocks.acquireCanonicalRevealClaimMock.mockResolvedValueOnce(false);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      false
    );

    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledOnce();
    expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce();
    expect(mocks.getSessionStateMock).toHaveBeenCalledTimes(2);
  });

  it('binds the generation only after the destination pane grid is stable across frames', async () => {
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    mocks.measureDimensionsMock
      .mockReturnValueOnce({ cols: 144, rows: 14 })
      .mockReturnValueOnce({ cols: 144, rows: 45 })
      .mockReturnValueOnce({ cols: 144, rows: 45 });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 144, rows: 14 },
        terminal: { cols: 144, rows: 14 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.measureDimensionsMock).toHaveBeenCalledTimes(3);
    expect(mocks.resizeForRendererMock).toHaveBeenCalledOnce();
    expect(mocks.resizeForRendererMock).toHaveBeenCalledWith(
      'project-1:task-1:conversation-1',
      7,
      144,
      45
    );
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledWith(
      { cols: 144, rows: 45 },
      expect.any(Function),
      { waitForCanonicalOutput: true, timeoutMs: expect.any(Number) }
    );
  });

  it('waits for replacement registration and never prepares the outgoing generation', async () => {
    mocks.getSessionStateMock
      .mockResolvedValueOnce({ generation: 7, live: true, registering: true })
      .mockResolvedValueOnce({ generation: 8, live: true, registering: false });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.resizeForRendererMock).toHaveBeenCalledOnce();
    expect(mocks.resizeForRendererMock).toHaveBeenCalledWith(
      'project-1:task-1:conversation-1',
      8,
      144,
      45
    );
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledOnce();
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(8);
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledOnce();
  });

  it('rebuilds G+1 before the first successful claim when it replaces the prepared generation', async () => {
    mocks.getSessionStateMock
      .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
      .mockResolvedValueOnce({ generation: 8, live: true, registering: false });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const stagedPty = {
      canonicalGeneration: 0,
      acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
      releaseCanonicalRevealClaim: mocks.releaseCanonicalRevealClaimMock,
      expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
      lastSentDims: { cols: 132, rows: 37 },
      terminal: { cols: 80, rows: 24 },
    } as unknown as FrontendPty;
    if (item) item.session.pty = stagedPty;
    mocks.ptyPrepareFirstFrameMock
      .mockImplementationOnce(async () => {
        // The replacement sentinel reaches the renderer after G was resized
        // and parsed, but before acquireCanonicalRevealClaim is invoked.
        Object.assign(stagedPty, { canonicalGeneration: 8 });
        return true;
      })
      .mockResolvedValueOnce(true);

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
      1,
      'project-1:task-1:conversation-1',
      7,
      144,
      45
    );
    expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
      2,
      'project-1:task-1:conversation-1',
      8,
      144,
      45
    );
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledTimes(2);
    expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce();
    expect(mocks.resizeForRendererMock.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.acquireCanonicalRevealClaimMock.mock.invocationCallOrder[0]
    );
    expect(mocks.releaseCanonicalRevealClaimMock).not.toHaveBeenCalled();
  });

  it('releases a successful G+1 claim that raced a prepared G frame, then rebuilds it', async () => {
    mocks.getSessionStateMock
      .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
      .mockResolvedValueOnce({ generation: 8, live: true, registering: false });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const stagedPty = {
      canonicalGeneration: 0,
      acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
      releaseCanonicalRevealClaim: mocks.releaseCanonicalRevealClaimMock,
      expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
      lastSentDims: { cols: 132, rows: 37 },
      terminal: { cols: 80, rows: 24 },
    } as unknown as FrontendPty;
    if (item) item.session.pty = stagedPty;
    mocks.acquireCanonicalRevealClaimMock
      .mockImplementationOnce(async () => {
        // G+1 becomes canonical while the main-process claim for it succeeds.
        Object.assign(stagedPty, { canonicalGeneration: 8 });
        return true;
      })
      .mockResolvedValueOnce(true);

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.releaseCanonicalRevealClaimMock).toHaveBeenCalledOnce();
    expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
      2,
      'project-1:task-1:conversation-1',
      8,
      144,
      45
    );
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledTimes(2);
    expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the staged frame when replacement registration races the reveal claim', async () => {
    vi.useFakeTimers();
    try {
      mocks.getSessionStateMock
        .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
        .mockResolvedValueOnce({ generation: 7, live: true, registering: true })
        .mockResolvedValueOnce({ generation: 8, live: true, registering: false });
      mocks.acquireCanonicalRevealClaimMock
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      if (item) {
        item.session.pty = {
          acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
          expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
          lastSentDims: { cols: 132, rows: 37 },
          terminal: { cols: 80, rows: 24 },
        } as unknown as FrontendPty;
      }

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 900);
      await vi.waitFor(() => expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce(), {
        interval: 1,
        timeout: 100,
      });
      await vi.advanceTimersByTimeAsync(STAGING_CANCELLATION_POLL_MS_FOR_TEST);
      await expect(opening).resolves.toBe(true);

      expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
        1,
        'project-1:task-1:conversation-1',
        7,
        144,
        45
      );
      expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
        2,
        'project-1:task-1:conversation-1',
        8,
        144,
        45
      );
      expect(mocks.expectCanonicalGenerationMock).toHaveBeenNthCalledWith(1, 7);
      expect(mocks.expectCanonicalGenerationMock).toHaveBeenNthCalledWith(2, 8);
      expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledTimes(2);
      expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a successful reveal claim past the preparation deadline until navigation cancels', async () => {
    vi.useFakeTimers();
    try {
      mocks.getSessionStateMock.mockResolvedValueOnce({
        generation: 7,
        live: true,
        registering: false,
      });
      let keepOpening = true;
      let claimShouldContinue: (() => boolean) | undefined;
      mocks.acquireCanonicalRevealClaimMock.mockImplementationOnce(
        async (shouldContinue: () => boolean) => {
          claimShouldContinue = shouldContinue;
          return true;
        }
      );
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      if (item) {
        item.session.pty = {
          acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
          expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
          lastSentDims: { cols: 132, rows: 37 },
          terminal: { cols: 80, rows: 24 },
        } as unknown as FrontendPty;
      }

      await expect(
        store.prepareConversationForOpen('conversation-1', () => keepOpening, 100)
      ).resolves.toBe(true);

      expect(claimShouldContinue?.()).toBe(true);
      await vi.advanceTimersByTimeAsync(101);
      expect(claimShouldContinue?.()).toBe(true);

      keepOpening = false;
      expect(claimShouldContinue?.()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reveal-claim retries at the original deadline', async () => {
    vi.useFakeTimers();
    try {
      mocks.getSessionStateMock
        .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
        .mockResolvedValue({ generation: 7, live: true, registering: true });
      mocks.acquireCanonicalRevealClaimMock.mockResolvedValue(false);
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      if (item) {
        item.session.pty = {
          acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
          expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
          lastSentDims: { cols: 132, rows: 37 },
          terminal: { cols: 80, rows: 24 },
        } as unknown as FrontendPty;
      }

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 100);
      await vi.waitFor(() => expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce(), {
        interval: 1,
        timeout: 50,
      });
      await vi.advanceTimersByTimeAsync(101);

      await expect(opening).resolves.toBe(false);
      expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledOnce();
      expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce();
      expect(mocks.getSessionStateMock.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels reveal-claim recovery before starting another generation probe', async () => {
    let keepOpening = true;
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    mocks.acquireCanonicalRevealClaimMock.mockImplementationOnce(async () => {
      keepOpening = false;
      return false;
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(
      store.prepareConversationForOpen('conversation-1', () => keepOpening, 900)
    ).resolves.toBe(false);

    expect(mocks.getSessionStateMock).toHaveBeenCalledOnce();
    expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledOnce();
    expect(mocks.acquireCanonicalRevealClaimMock).toHaveBeenCalledOnce();
  });

  it('does not mark or stage a live session when generation-bound resize fails', async () => {
    mocks.getSessionStateMock.mockResolvedValue({
      generation: 7,
      live: true,
      registering: false,
    });
    mocks.resizeForRendererMock.mockResolvedValue({
      success: false,
      error: { type: 'not_found' },
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionRunning = item ? vi.spyOn(item, 'markSessionRunning') : undefined;
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      false
    );

    expect(mocks.getSessionStateMock).toHaveBeenCalledTimes(2);
    expect(mocks.resizeForRendererMock).toHaveBeenCalledTimes(2);
    expect(markSessionRunning).not.toHaveBeenCalled();
    expect(mocks.expectCanonicalGenerationMock).not.toHaveBeenCalled();
    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
    expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
  });

  it('re-probes once and binds the replacement generation before staging', async () => {
    mocks.getSessionStateMock
      .mockResolvedValueOnce({ generation: 7, live: true, registering: false })
      .mockResolvedValueOnce({ generation: 8, live: true, registering: false });
    mocks.resizeForRendererMock
      .mockResolvedValueOnce({
        success: true,
        data: { generation: 8, changed: true },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { generation: 8, changed: true },
      });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
    }

    await expect(store.prepareConversationForOpen('conversation-1', () => true, 900)).resolves.toBe(
      true
    );

    expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
      1,
      'project-1:task-1:conversation-1',
      7,
      144,
      45
    );
    expect(mocks.resizeForRendererMock).toHaveBeenNthCalledWith(
      2,
      'project-1:task-1:conversation-1',
      8,
      144,
      45
    );
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledOnce();
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(8);
  });

  it('returns at the absolute deadline without subscribing when stopped resume hangs', async () => {
    vi.useFakeTimers();
    try {
      mocks.resumeConversationMock.mockReturnValueOnce(new Promise(() => {}));
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      if (item) {
        item.session.pty = {
          acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
          expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
          lastSentDims: null,
          terminal: { cols: 80, rows: 24 },
        } as unknown as FrontendPty;
      }

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 100);
      await flushPromises();
      expect(mocks.resumeConversationMock).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(101);
      await expect(opening).resolves.toBe(false);
      expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
      expect(mocks.expectCanonicalGenerationMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands a freshly resumed renderer to the visible surface when staging reaches its deadline', async () => {
    vi.useFakeTimers();
    try {
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      const preparedPty = {
        canonicalGeneration: 0,
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: null,
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
      mocks.ptyConnectMock.mockImplementationOnce(() => {
        if (item) item.session.pty = preparedPty;
        return Promise.resolve();
      });
      mocks.ptyPrepareFirstFrameMock.mockReturnValueOnce(new Promise(() => {}));

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 100);
      await vi.waitFor(() => expect(mocks.ptyPrepareFirstFrameMock).toHaveBeenCalledOnce(), {
        interval: 1,
        timeout: 50,
      });
      expect(mocks.resumeConversationMock).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(101);
      await expect(opening).resolves.toBe(false);

      // `false` means the still-current routed ConversationSession now owns
      // visible-frame readiness. Disposing its fresh xterm here leaves that
      // panel with no frame source and the task-opening Logo can never clear.
      expect(item?.session.pty).toBe(preparedPty);
      expect(mocks.ptyDiscardUnconnectedRendererMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns at the absolute deadline when renderer settings/connect never settles', async () => {
    vi.useFakeTimers();
    try {
      mocks.ptyConnectMock.mockReturnValueOnce(new Promise(() => {}));
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 100);
      await flushPromises();
      expect(mocks.ptyConnectMock).toHaveBeenCalledOnce();
      expect(mocks.getSessionStateMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(101);
      await expect(opening).resolves.toBe(false);
      expect(mocks.getSessionStateMock).not.toHaveBeenCalled();
      expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns at the deadline when a background window never delivers a layout frame', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    try {
      mocks.getPaneContainerMock.mockReturnValue(null);
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      if (item) {
        item.session.pty = {
          acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
          expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
          lastSentDims: null,
          terminal: { cols: 80, rows: 24 },
        } as unknown as FrontendPty;
      }

      const opening = store.prepareConversationForOpen('conversation-1', () => true, 100);
      await flushPromises();
      expect(mocks.getSessionStateMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(101);
      await expect(opening).resolves.toBe(false);
      expect(mocks.resizeForRendererMock).not.toHaveBeenCalled();
      expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('cancels a late live probe and reclaims the renderer created by that open', async () => {
    vi.useFakeTimers();
    try {
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const item = store.conversations.get('conversation-1');
      const preparedPty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: null,
        terminal: { cols: 80, rows: 24 },
      } as unknown as FrontendPty;
      mocks.ptyConnectMock.mockImplementationOnce(() => {
        if (item) item.session.pty = preparedPty;
        return Promise.resolve();
      });
      mocks.getSessionStateMock.mockReturnValueOnce(new Promise(() => {}));
      let keepOpening = true;

      const opening = store.prepareConversationForOpen('conversation-1', () => keepOpening, 900);
      await flushPromises();
      expect(mocks.getSessionStateMock).toHaveBeenCalledOnce();
      keepOpening = false;

      await vi.advanceTimersByTimeAsync(25);
      await expect(opening).resolves.toBe(false);
      expect(mocks.ptyDiscardUnconnectedRendererMock).toHaveBeenCalledWith(preparedPty);
      expect(mocks.resizeForRendererMock).not.toHaveBeenCalled();
      expect(mocks.ptyPrepareFirstFrameMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('attaches to an already-live PTY without calling the resume controller', async () => {
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 37 },
      } as unknown as FrontendPty;
    }

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);

    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(7);
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 132, 37);
    expect(item?.getSessionGeneration()).toBe(7);
    expect(item?.sessionExited).toBe(false);
  });

  it('fetches a missing transcript fence for an already-live cold Codex PTY', async () => {
    const surfaceAnchor = {
      kind: 'anchor' as const,
      segments: ['latest restored answer'],
    };
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    mocks.resumeConversationMock.mockResolvedValueOnce({
      running: true,
      generation: 7,
      surfaceAnchor,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [
      { ...conversation, runtimeId: 'codex' },
    ]);
    const item = store.conversations.get('conversation-1');
    const hasCanonicalSurfaceFence = vi.fn(() => false);
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        expectCanonicalSurfaceAnchor: mocks.expectCanonicalSurfaceAnchorMock,
        hasCanonicalSurfaceFence,
        lastSentDims: { cols: 132, rows: 37 },
      } as unknown as FrontendPty;
    }

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);

    expect(hasCanonicalSurfaceFence).toHaveBeenCalledWith(7);
    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      undefined
    );
    expect(mocks.expectCanonicalSurfaceAnchorMock).toHaveBeenCalledWith(7, surfaceAnchor);
  });

  it('reuses an exact-generation Codex transcript fence on a live PTY', async () => {
    mocks.getSessionStateMock.mockResolvedValueOnce({
      generation: 7,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [
      { ...conversation, runtimeId: 'codex' },
    ]);
    const item = store.conversations.get('conversation-1');
    const hasCanonicalSurfaceFence = vi.fn(() => true);
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        hasCanonicalSurfaceFence,
        lastSentDims: { cols: 132, rows: 37 },
      } as unknown as FrontendPty;
    }

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);

    expect(hasCanonicalSurfaceFence).toHaveBeenCalledWith(7);
    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
  });

  it('reapplies the latest measured terminal size after a slow resume', async () => {
    let resolveResume!: (result: { running: boolean; generation: number }) => void;
    mocks.resumeConversationMock.mockImplementationOnce(
      () =>
        new Promise<{ running: boolean; generation: number }>((resolve) => {
          resolveResume = resolve;
        })
    );
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionRunning = item ? vi.spyOn(item, 'markSessionRunning') : undefined;

    const resume = store.resumeConversation('conversation-1', { cols: 80, rows: 24 });
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        lastSentDims: { cols: 132, rows: 61 },
      } as unknown as FrontendPty;
    }
    resolveResume({ running: true, generation: 2 });

    await expect(resume).resolves.toBe(true);
    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 80, rows: 24 }
    );
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 132, 61);
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(2);
    expect(markSessionRunning).toHaveBeenCalledWith(2);
  });

  it('does not apply a Codex transcript fence to another provider resume', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce({
      running: true,
      generation: 2,
      surfaceAnchor: { kind: 'unverifiable' },
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
        expectCanonicalSurfaceAnchor: mocks.expectCanonicalSurfaceAnchorMock,
      } as unknown as FrontendPty;
    }

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);

    expect(mocks.expectCanonicalSurfaceAnchorMock).not.toHaveBeenCalled();
    expect(mocks.expectCanonicalGenerationMock).toHaveBeenCalledWith(2);
  });

  it('accepts a legacy boolean true resume response during a renderer-only update', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce(true);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);
    item?.setWorking();
    if (item) {
      item.session.pty = {
        acquireCanonicalRevealClaim: mocks.acquireCanonicalRevealClaimMock,
        expectCanonicalGeneration: mocks.expectCanonicalGenerationMock,
      } as unknown as FrontendPty;
    }

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(mocks.expectCanonicalGenerationMock).not.toHaveBeenCalled();
  });

  it('accepts a legacy boolean false resume response', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce(false);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setWorking();

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(false);

    expect(item?.sessionExited).toBe(true);
    expect(item?.status).toBe('idle');
    expect(mocks.expectCanonicalGenerationMock).not.toHaveBeenCalled();
  });

  it('keeps a stopped session actionable when automatic resume does not start a process', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce({ running: false, generation: 1 });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(false);

    expect(item?.status).toBe('idle');
    expect(item?.sessionExited).toBe(true);
    expect(markSessionExited).toHaveBeenCalledWith(1);
  });

  it('preserves an external writer as a readable ownership state', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce({
      running: false,
      generation: 1,
      reason: 'external-writer',
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setSessionExited(true);
    item?.setWorking();

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(false);

    expect(item?.sessionResumeBlockReason).toBe('external-writer');
    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('ignores an older stopped response after a newer resume succeeds', async () => {
    let resolveOlder!: (result: { running: boolean; generation: number }) => void;
    mocks.resumeConversationMock
      .mockImplementationOnce(
        () =>
          new Promise<{ running: boolean; generation: number }>((resolve) => {
            resolveOlder = resolve;
          })
      )
      .mockResolvedValueOnce({ running: true, generation: 2 });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    const olderResume = store.resumeConversation('conversation-1');
    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);
    resolveOlder({ running: false, generation: 2 });
    await expect(olderResume).resolves.toBe(false);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('ignores an older resume rejection after a newer resume succeeds', async () => {
    let rejectOlder!: (error: Error) => void;
    mocks.resumeConversationMock
      .mockImplementationOnce(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectOlder = reject;
          })
      )
      .mockResolvedValueOnce({ running: true, generation: 2 });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    const olderResume = store.resumeConversation('conversation-1');
    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);
    rejectOlder(new Error('older resume failed'));
    await expect(olderResume).resolves.toBe(false);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('ignores a generationless rejection after the session advances to a new generation', async () => {
    let rejectResume!: (error: Error) => void;
    mocks.resumeConversationMock.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectResume = reject;
        })
    );
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    const resume = store.resumeConversation('conversation-1');
    item?.markSessionRunning(3);
    rejectResume(new Error('obsolete resume failed'));
    await expect(resume).resolves.toBe(false);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('ignores an older legacy false response after a newer resume succeeds', async () => {
    let resolveOlder!: (running: boolean) => void;
    mocks.resumeConversationMock
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveOlder = resolve;
          })
      )
      .mockResolvedValueOnce({ running: true, generation: 2 });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    const olderResume = store.resumeConversation('conversation-1');
    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);
    resolveOlder(false);
    await expect(olderResume).resolves.toBe(false);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('ignores a legacy false response after the session advances to a new generation', async () => {
    let resolveResume!: (running: boolean) => void;
    mocks.resumeConversationMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveResume = resolve;
        })
    );
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const markSessionExited = item ? vi.spyOn(item, 'markSessionExited') : undefined;
    item?.setWorking();

    const resume = store.resumeConversation('conversation-1');
    item?.markSessionRunning(3);
    resolveResume(false);
    await expect(resume).resolves.toBe(false);

    expect(item?.sessionExited).toBe(false);
    expect(item?.status).toBe('working');
    expect(markSessionExited).not.toHaveBeenCalled();
  });

  it('keeps a stopped session actionable when automatic resume throws', async () => {
    mocks.resumeConversationMock.mockRejectedValueOnce(new Error('resume failed'));
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(false);

    expect(store.conversations.get('conversation-1')?.sessionExited).toBe(true);
  });

  it('ignores an exit from another project that happens to reuse task and conversation ids', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const listener = mocks.listeners.get(agentSessionExitedChannel.name);

    listener?.({
      projectId: 'project-2',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'project-2:task-1:conversation-1',
      generation: 1,
      exitCode: 0,
    });

    expect(item?.sessionExited).toBe(false);
  });

  it('ignores a delayed exit from the previous PTY generation after resume', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce({ running: true, generation: 2 });
    mocks.getSessionStateMock.mockResolvedValue({
      generation: 2,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const listener = mocks.listeners.get(agentSessionExitedChannel.name);

    await expect(store.resumeConversation('conversation-1')).resolves.toBe(true);
    listener?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'project-1:task-1:conversation-1',
      generation: 1,
      exitCode: 0,
    });
    await flushPromises();

    expect(item?.sessionExited).toBe(false);

    mocks.getSessionStateMock.mockResolvedValue({
      generation: 2,
      live: false,
      registering: false,
    });

    listener?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'project-1:task-1:conversation-1',
      generation: 2,
      exitCode: 0,
    });
    await flushPromises();

    expect(item?.sessionExited).toBe(true);
  });

  it('keeps a stopped notice hidden while the replacement PTY is registering', async () => {
    mocks.getSessionStateMock.mockResolvedValue({
      generation: 1,
      live: false,
      registering: true,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    const listener = mocks.listeners.get(agentSessionExitedChannel.name);

    listener?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'project-1:task-1:conversation-1',
      generation: 1,
      exitCode: 0,
    });
    await flushPromises();

    expect(item?.sessionExited).toBe(false);
  });

  it('clears an inherited stopped state when the main process still owns the PTY', async () => {
    mocks.getSessionStateMock.mockResolvedValue({
      generation: 4,
      live: true,
      registering: false,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);

    await store.reconcileSessionLiveness('conversation-1');

    expect(item?.sessionExited).toBe(false);
  });

  it('uses the active-session fallback while a renderer update precedes main-process reload', async () => {
    mocks.getSessionStateMock.mockRejectedValueOnce(new Error('unknown pty RPC'));
    mocks.getConversationSessionInfoMock.mockResolvedValueOnce({ running: true });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);

    await store.reconcileSessionLiveness('conversation-1');

    expect(mocks.getConversationSessionInfoMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1'
    );
    expect(item?.sessionExited).toBe(false);
  });

  it('dismisses the stopped-session notice without changing exit state and shows it on a new exit', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');

    item?.markSessionExited();
    item?.dismissSessionExitNotice();

    expect(item?.sessionExited).toBe(true);
    expect(item?.sessionExitNoticeDismissed).toBe(true);

    item?.markSessionExited();

    expect(item?.sessionExitNoticeDismissed).toBe(false);
  });

  it('restarts a conversation and reconnects the frontend PTY', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.restartConversation('conversation-1', { cols: 120, rows: 30 });

    expect(mocks.restartConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 120, rows: 30 },
      undefined,
      undefined,
      undefined
    );
    expect(mocks.ptyReconnectMock).toHaveBeenCalled();
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 120, 30);
  });

  it('reloads the conversation view without restarting the Agent session', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.reloadConversationView('conversation-1');

    expect(mocks.ptyReconnectMock).toHaveBeenCalledOnce();
    expect(mocks.restartConversationMock).not.toHaveBeenCalled();
    expect(mocks.resumeConversationMock).not.toHaveBeenCalled();
  });

  it('dismisses the exited state as soon as a restart begins', async () => {
    let finishRestart: ((result: { generation: number }) => void) | undefined;
    mocks.restartConversationMock.mockReturnValueOnce(
      new Promise<{ generation: number }>((resolve) => {
        finishRestart = resolve;
      })
    );
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);

    const restart = store.restartConversation('conversation-1');

    expect(item?.sessionExited).toBe(false);
    finishRestart?.({ generation: 2 });
    await restart;
    expect(item?.sessionExited).toBe(false);
  });

  it('supports a restart response from the previous main-process controller', async () => {
    mocks.restartConversationMock.mockResolvedValueOnce(undefined);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);

    await store.restartConversation('conversation-1');

    expect(mocks.ptyReconnectMock).toHaveBeenCalledTimes(1);
    expect(mocks.expectCanonicalGenerationMock).not.toHaveBeenCalled();
    expect(item?.sessionExited).toBe(false);
  });

  it('passes a newly installed skill when reloading the current session', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.restartConversation('conversation-1', undefined, undefined, 'skill:local:new');

    expect(mocks.restartConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      undefined,
      undefined,
      'skill:local:new',
      undefined
    );
  });

  it('passes selected runtime parameters when restarting the current session', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.restartConversation('conversation-1', undefined, undefined, undefined, {
      model: 'o4-mini',
      reasoningEffort: 'high',
      fastMode: true,
    });

    expect(mocks.restartConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      undefined,
      undefined,
      undefined,
      { model: 'o4-mini', reasoningEffort: 'high', fastMode: true }
    );
  });

  it('refreshes loaded conversations when ensuring an externally added conversation', async () => {
    const externalConversation = {
      ...conversation,
      id: 'conversation-2',
      title: 'Imported Codex',
      runtimeId: 'codex' as const,
    };
    mocks.getConversationsForTaskMock.mockResolvedValueOnce([conversation, externalConversation]);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await expect(store.ensureConversation('conversation-2')).resolves.toBe(true);

    expect(mocks.getConversationsForTaskMock).toHaveBeenCalledWith('project-1', 'task-1');
    expect(store.conversations.get('conversation-2')?.data).toEqual(externalConversation);
  });

  it('bounds the refresh used to ensure an externally added conversation', async () => {
    vi.useFakeTimers();
    try {
      mocks.getConversationsForTaskMock.mockReturnValueOnce(new Promise(() => {}));
      const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
      const ensuring = store.ensureConversation('conversation-2');
      const rejected = expect(ensuring).rejects.toThrow('Conversation snapshot load exceeded');

      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;

      expect(mocks.getConversationsForTaskMock).toHaveBeenCalledOnce();
      expect(store.hasAuthoritativeSnapshot).toBe(true);
      expect(store.conversations.has('conversation-2')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates runtime status for preloaded conversations without re-emitting', async () => {
    mocks.getConversationRuntimeStatusesMock.mockResolvedValueOnce({
      'conversation-1': 'working',
    });

    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    await flushPromises();

    expect(store.conversations.get('conversation-1')?.status).toBe('working');
    expect(mocks.getConversationRuntimeStatusesMock).toHaveBeenCalledWith('project-1', 'task-1', [
      'conversation-1',
    ]);
    expect(mocks.eventEmitMock).not.toHaveBeenCalledWith(agentSessionStatusChangedChannel, {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'working',
    });
  });

  it('keeps the provider fence snapshot emitted during cold status hydration', async () => {
    mocks.getConversationRuntimeStatusesMock.mockImplementationOnce(async () => {
      // Match real IPC ordering: main publishes the richer event before its
      // status-only RPC response settles, after this constructor turn has
      // installed the event listener.
      await Promise.resolve();
      mocks.listeners.get(agentSessionStatusChangedChannel.name)?.({
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        status: 'working',
        providerTurnConfirmed: true,
      });
      return { 'conversation-1': 'working' };
    });

    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    await flushPromises();

    const item = store.conversations.get('conversation-1');
    expect(item?.status).toBe('working');
    expect(item?.providerTurnConfirmed).toBe(true);
  });

  it('does not let runtime hydration overwrite a newer local status transition', async () => {
    let resolveHydration!: (statuses: Record<string, 'idle' | 'working'>) => void;
    mocks.getConversationRuntimeStatusesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHydration = resolve;
      })
    );

    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    store.conversations.get('conversation-1')?.setWorking({ force: true });
    resolveHydration({ 'conversation-1': 'idle' });
    await flushPromises();

    expect(store.conversations.get('conversation-1')?.status).toBe('working');
    store.dispose();
  });

  it('applies conversation rename events from session title sync', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const listener = mocks.listeners.get(conversationRenamedChannel.name);

    listener?.({
      conversationId: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Synced Codex title',
    });

    expect(store.conversations.get('conversation-1')?.data.title).toBe('Synced Codex title');
  });

  it('keeps auto-rename events that arrive before a created conversation is merged', async () => {
    const createdConversation: Conversation = {
      ...conversation,
      id: 'conversation-2',
      runtimeId: 'codex',
      title: 'Codex',
      isInitialConversation: false,
    };
    mocks.createConversationMock.mockImplementationOnce(async () => {
      const listener = mocks.listeners.get(conversationRenamedChannel.name);
      listener?.({
        conversationId: 'conversation-2',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'Synced Codex title',
      });
      return createdConversation;
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.createConversation({
      id: 'conversation-2',
      projectId: 'project-1',
      taskId: 'task-1',
      runtime: 'codex',
      title: 'Codex',
    });

    expect(store.conversations.get('conversation-2')?.data.title).toBe('Synced Codex title');
    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();
  });

  it('adds a context fork without connecting before a terminal surface requests it', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    mocks.ptyConnectMock.mockClear();
    const params = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 0,
      target: { kind: 'claude-message' as const, messageId: 'prompt-1' },
    };

    const fork = await store.forkConversationAtPrompt(params);

    expect(mocks.forkConversationAtPromptMock).toHaveBeenCalledWith(params);
    expect(fork.id).toBe('conversation-fork');
    expect(store.conversations.get('conversation-fork')?.data).toEqual(fork);
    expect(store.conversations.get('conversation-fork')?.data).toMatchObject({
      forkedFromConversationId: 'conversation-1',
      forkedFromPromptIndex: 0,
    });
    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();
  });

  it('adds a full conversation fork and deduplicates repeated requests', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    mocks.ptyConnectMock.mockClear();
    const params = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      initialSize: { cols: 120, rows: 36 },
    };

    const first = store.forkConversation(params);
    const second = store.forkConversation(params);
    const [fork] = await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(mocks.forkConversationMock).toHaveBeenCalledTimes(1);
    expect(mocks.forkConversationMock).toHaveBeenCalledWith(params);
    expect(store.conversations.get('conversation-fork')?.data).toEqual(fork);
    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();

    await store.forkConversation(params);
    expect(mocks.forkConversationMock).toHaveBeenCalledTimes(2);
  });

  it('leaves a restored fork disconnected when its initial backend launch failed', async () => {
    mocks.forkConversationAtPromptMock.mockResolvedValueOnce({
      ...conversation,
      id: 'conversation-fork',
      title: 'Claude · #1',
      isInitialConversation: false,
      resume: true,
    });
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    mocks.ptyConnectMock.mockClear();

    const fork = await store.forkConversationAtPrompt({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 0,
      target: { kind: 'claude-message', messageId: 'answer-1' },
    });

    expect(fork.resume).toBe(true);
    expect(store.conversations.get('conversation-fork')?.sessionExited).toBe(true);
    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent context forks for the same provider checkpoint', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const params = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 0,
      target: { kind: 'claude-message' as const, messageId: 'answer-1' },
    };

    const first = store.forkConversationAtPrompt(params);
    const second = store.forkConversationAtPrompt(params);

    expect(first).toBe(second);
    expect(store.isContextForkPending(params)).toBe(true);
    expect(mocks.forkConversationAtPromptMock).toHaveBeenCalledTimes(1);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(store.isContextForkPending(params)).toBe(false);

    await store.forkConversationAtPrompt(params);
    expect(mocks.forkConversationAtPromptMock).toHaveBeenCalledTimes(2);
  });

  it('clears a failed context fork so the same checkpoint can be retried', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const params = {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 0,
      target: { kind: 'codex-turn' as const, turnId: 'turn-1' },
    };
    mocks.forkConversationAtPromptMock.mockRejectedValueOnce(new Error('fork failed'));

    await expect(store.forkConversationAtPrompt(params)).rejects.toThrow('fork failed');
    expect(store.isContextForkPending(params)).toBe(false);

    await expect(store.forkConversationAtPrompt(params)).resolves.toMatchObject({
      id: 'conversation-fork',
    });
    expect(mocks.forkConversationAtPromptMock).toHaveBeenCalledTimes(2);
  });

  it('archives conversations via RPC and leaves removal to the archive event', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.archiveConversation('conversation-1', { runPreArchiveCommand: true });

    expect(mocks.archiveConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { runPreArchiveCommand: true }
    );
    // The main process owns the archive (it may run a pre-archive command
    // first); the store is only pruned by the conversationArchivedChannel event.
    expect(store.conversations.has('conversation-1')).toBe(true);
    expect(mocks.ptyDisposeMock).not.toHaveBeenCalled();
  });

  it('removes conversations when an archive event arrives', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const listener = mocks.listeners.get(conversationArchivedChannel.name);

    listener?.({
      conversationId: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
    });

    expect(store.conversations.has('conversation-1')).toBe(false);
    expect(mocks.ptyDisposeMock).toHaveBeenCalled();
  });

  it('removes a conversation when it moves out of this task', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const listener = mocks.listeners.get(conversationMovedChannel.name);

    listener?.({
      conversation: { ...conversation, taskId: 'task-2' },
      sourceTaskId: 'task-1',
      targetTaskId: 'task-2',
    });

    expect(store.conversations.has('conversation-1')).toBe(false);
    expect(mocks.ptyDisposeMock).toHaveBeenCalled();
  });

  it('registers a moved conversation lazily with its new PTY identity', async () => {
    const store = new ConversationManagerStore('project-1', 'task-2');
    const listener = mocks.listeners.get(conversationMovedChannel.name);
    mocks.ptyConnectMock.mockClear();

    listener?.({
      conversation: { ...conversation, taskId: 'task-2' },
      sourceTaskId: 'task-1',
      targetTaskId: 'task-2',
    });
    await flushPromises();

    expect(store.conversations.get('conversation-1')?.session.sessionId).toBe(
      'project-1:task-2:conversation-1'
    );
    expect(mocks.ptyConnectMock).not.toHaveBeenCalled();
    expect(mocks.getConversationRuntimeStatusesMock).toHaveBeenCalledWith('project-1', 'task-2', [
      'conversation-1',
    ]);
  });
});
