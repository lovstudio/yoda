import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { agentSessionStatusChangedChannel } from '@shared/events/agentEvents';
import {
  conversationArchivedChannel,
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
  providerId: 'claude',
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
      providerId: 'codex' as const,
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

  it('archives conversations optimistically and disposes the session on success', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [conversation]);

    await store.archiveConversation('conversation-1');

    expect(mocks.archiveConversationMock).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1'
    );
    expect(store.conversations.has('conversation-1')).toBe(false);
    expect(mocks.ptyDisposeMock).toHaveBeenCalled();
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
});
