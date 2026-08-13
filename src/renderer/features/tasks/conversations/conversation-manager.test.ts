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
  ptyConnectMock: vi.fn(),
  ptyDisposeMock: vi.fn(),
  ptyReconnectMock: vi.fn(),
  ptyResizeMock: vi.fn(),
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
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = mocks.ptyConnectMock;
    reconnect = mocks.ptyReconnectMock;
    dispose = mocks.ptyDisposeMock;
  },
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  it('accepts a legacy boolean true resume response during a renderer-only update', async () => {
    mocks.resumeConversationMock.mockResolvedValueOnce(true);
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);
    const item = store.conversations.get('conversation-1');
    item?.setSessionExited(true);
    item?.setWorking();
    if (item) {
      item.session.pty = {
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
