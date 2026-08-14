import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtyId } from '@shared/ptyId';
import { enrichEvent } from './event-enricher';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
  },
}));

describe('enrichEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    // `where` is awaited directly by the sessionSource scan and chained with
    // `.limit()` by the id lookups, so it must support both shapes.
    const whereResult = Object.assign(Promise.resolve([]), { limit: mocks.limit });
    mocks.where.mockReturnValue(whereResult);
    mocks.limit.mockResolvedValue([{ projectId: 'project-1', taskId: 'task-1' }]);
  });

  it('maps Codex turn completion notifications to stop events', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('codex', 'conversation-1'),
      type: 'notification',
      body: JSON.stringify({
        type: 'agent-turn-complete',
        last_assistant_message: 'Done.',
      }),
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('stop');
    expect(event!.runtimeId).toBe('codex');
    expect(event!.projectId).toBe('project-1');
    expect(event!.taskId).toBe('task-1');
    expect(event!.conversationId).toBe('conversation-1');
    expect(event!.payload.lastAssistantMessage).toBe('Done.');
    expect(event!.payload.notificationType).toBeUndefined();
  });

  it('preserves regular Codex notification events', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('codex', 'conversation-1'),
      type: 'notification',
      body: JSON.stringify({
        notification_type: 'permission_prompt',
      }),
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('notification');
    expect(event!.payload.notificationType).toBe('permission_prompt');
  });

  it('returns null (no 500) when the conversation no longer exists', async () => {
    mocks.limit.mockResolvedValue([]); // conversation deleted mid-flight
    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'gone-conversation'),
      type: 'stop',
      body: '{}',
    });
    expect(event).toBeNull();
  });

  // `$YODA_PTY_ID` lives in the project-wide .claude/settings.local.json, so
  // every Claude session in a project reports the LAST-started conversation.
  // The payload's own session_id is per-process and must win, or one session's
  // permission prompt flips an unrelated session to "awaiting input".
  it('attributes the hook to the firing session, not the stale ptyId', async () => {
    mocks.limit
      .mockResolvedValueOnce([{ id: 'firing-conversation' }]) // session_id lookup
      .mockResolvedValueOnce([{ projectId: 'project-1', taskId: 'task-9' }]);

    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'last-started-conversation'),
      type: 'notification',
      body: JSON.stringify({
        session_id: 'firing-conversation',
        notification_type: 'permission_prompt',
      }),
    });

    expect(event).not.toBeNull();
    expect(event!.conversationId).toBe('firing-conversation');
    expect(event!.taskId).toBe('task-9');
    // Downstream consumers parse ptyId back into a conversation id, so it must
    // be rewritten to match rather than carry the stale value.
    expect(event!.ptyId).toBe(makePtyId('claude', 'firing-conversation'));
  });

  it('resolves an adopted session via its sessionSource id', async () => {
    mocks.limit
      .mockResolvedValueOnce([]) // no conversation whose id == session_id
      .mockResolvedValueOnce([{ projectId: 'project-1', taskId: 'task-3' }]);
    // Every `where` result doubles as the awaited sessionSource scan and as the
    // `.limit()` chain used by the id lookups.
    mocks.where.mockReturnValue(
      Object.assign(
        Promise.resolve([
          {
            id: 'adopted-conversation',
            config: JSON.stringify({
              sessionSource: { runtimeId: 'claude', sessionId: 'provider-session' },
            }),
          },
        ]),
        { limit: mocks.limit }
      )
    );

    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'other-conversation'),
      type: 'stop',
      body: JSON.stringify({ session_id: 'provider-session' }),
    });

    expect(event).not.toBeNull();
    expect(event!.conversationId).toBe('adopted-conversation');
  });

  // A stray CLI started outside Yoda shares the project settings file and so
  // fires hooks carrying a foreign session_id. Attributing those to the ptyId's
  // conversation would corrupt a real session's run state.
  it('drops hooks from sessions Yoda does not track', async () => {
    mocks.limit.mockResolvedValueOnce([]); // unknown session_id
    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'real-conversation'),
      type: 'notification',
      body: JSON.stringify({ session_id: 'foreign-session' }),
    });
    expect(event).toBeNull();
  });
});
