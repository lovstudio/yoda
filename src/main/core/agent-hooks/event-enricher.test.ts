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
    mocks.where.mockReturnValue({ limit: mocks.limit });
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

    expect(event.type).toBe('stop');
    expect(event.providerId).toBe('codex');
    expect(event.projectId).toBe('project-1');
    expect(event.taskId).toBe('task-1');
    expect(event.conversationId).toBe('conversation-1');
    expect(event.payload.lastAssistantMessage).toBe('Done.');
    expect(event.payload.notificationType).toBeUndefined();
  });

  it('preserves regular Codex notification events', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('codex', 'conversation-1'),
      type: 'notification',
      body: JSON.stringify({
        notification_type: 'permission_prompt',
      }),
    });

    expect(event.type).toBe('notification');
    expect(event.payload.notificationType).toBe('permission_prompt');
  });
});
