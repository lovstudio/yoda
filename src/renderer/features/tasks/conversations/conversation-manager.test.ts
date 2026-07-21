import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { agentSessionStatusChangedChannel } from '@shared/events/agentEvents';
import {
  conversationArchivedChannel,
  conversationMovedChannel,
  conversationRenamedChannel,
} from '@shared/events/conversationEvents';
import { ConversationManagerStore } from './conversation-manager';

const mocks = vi.hoisted(() => ({
  eventEmitMock: vi.fn(),
  eventOnMock: vi.fn(),
  ptyConnectMock: vi.fn(),
  ptyDisposeMock: vi.fn(),
  ptyReconnectMock: vi.fn(),
  ptyResizeMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  createConversationMock: vi.fn(),
  forkConversationMock: vi.fn(),
  forkConversationAtPromptMock: vi.fn(),
  getConversationRuntimeStatusesMock: vi.fn(),
  getConversationsForTaskMock: vi.fn(),
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
      getConversationRuntimeStatuses: mocks.getConversationRuntimeStatusesMock,
      getConversationsForTask: mocks.getConversationsForTaskMock,
      resumeConversation: mocks.resumeConversationMock,
      restartConversation: mocks.restartConversationMock,
      touchConversation: mocks.touchConversationMock,
    },
    pty: {
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
    mocks.resumeConversationMock.mockResolvedValue(undefined);
    mocks.restartConversationMock.mockResolvedValue(undefined);
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
    mocks.getConversationRuntimeStatusesMock.mockResolvedValue({});
    mocks.getConversationsForTaskMock.mockResolvedValue([]);
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

    await store.resumeConversation('conversation-1', { cols: 132, rows: 37 });

    expect(mocks.resumeConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 132, rows: 37 }
    );
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 132, 37);
  });

  it('restarts a conversation and reconnects the frontend PTY', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.restartConversation('conversation-1', { cols: 120, rows: 30 });

    expect(mocks.restartConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      { cols: 120, rows: 30 },
      undefined
    );
    expect(mocks.ptyReconnectMock).toHaveBeenCalled();
    expect(mocks.ptyResizeMock).toHaveBeenCalledWith('project-1:task-1:conversation-1', 120, 30);
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
  });

  it('adds a context fork returned by the main process and connects its PTY', async () => {
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
    expect(mocks.ptyConnectMock).toHaveBeenCalled();
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
    expect(mocks.ptyConnectMock).toHaveBeenCalledTimes(1);

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

  it('registers a conversation that moves into this task with its new PTY identity', async () => {
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
    expect(mocks.ptyConnectMock).toHaveBeenCalled();
    expect(mocks.getConversationRuntimeStatusesMock).toHaveBeenCalledWith('project-1', 'task-2', [
      'conversation-1',
    ]);
  });
});
