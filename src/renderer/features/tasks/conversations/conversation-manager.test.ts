import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { ConversationManagerStore } from './conversation-manager';

const mocks = vi.hoisted(() => ({
  eventOnMock: vi.fn(),
  ptyConnectMock: vi.fn(),
  ptyDisposeMock: vi.fn(),
  soundPlayMock: vi.fn(),
  touchConversationMock: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: mocks.eventOnMock,
  },
  rpc: {
    conversations: {
      touchConversation: mocks.touchConversationMock,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = mocks.ptyConnectMock;
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

describe('ConversationManagerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventOnMock.mockReturnValue(vi.fn());
    mocks.touchConversationMock.mockResolvedValue(undefined);
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
  });
});
