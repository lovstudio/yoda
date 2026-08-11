import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationMovedChannel } from '@shared/events/conversationEvents';
import { conversations, tasks } from '@main/db/schema';
import { moveConversation } from './moveConversation';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  hookEmit: vi.fn(),
  mapConversation: vi.fn(),
  resolveTask: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  sourceStop: vi.fn(),
  sourceRestart: vi.fn(),
  stabilizePendingInitialPromptDelivery: vi.fn(),
  targetStart: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select, update: mocks.update },
}));

vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));
vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));
vi.mock('./conversation-events', () => ({
  conversationEvents: { _emit: mocks.hookEmit },
}));
vi.mock('./pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: vi.fn(),
  stabilizePendingInitialPromptDelivery: mocks.stabilizePendingInitialPromptDelivery,
}));
vi.mock('./utils', () => ({ mapConversationRowToConversation: mocks.mapConversation }));

const sourceRow = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  title: 'Move me',
  runtime: 'claude',
  config: null,
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  lastInteractedAt: '2026-07-19T01:00:00.000Z',
  isInitialConversation: true,
  archivedAt: null,
  forkedFromConversationId: null,
  forkedFromPromptIndex: null,
};

function selectChain(result: unknown[]) {
  return {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit: vi.fn(async () => result),
  };
}

describe('moveConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const selectResults = [[sourceRow], [{ id: 'task-2' }], []];
    mocks.select.mockImplementation(() => selectChain(selectResults.shift() ?? []));

    const movedRow = { ...sourceRow, taskId: 'task-2' };
    mocks.update.mockImplementation((table: unknown) => {
      if (table === conversations) {
        return {
          set: () => ({
            where: () => ({ returning: async () => [movedRow] }),
          }),
        };
      }
      expect(table).toBe(tasks);
      return { set: () => ({ where: async () => undefined }) };
    });
    mocks.resolveTask.mockImplementation((_projectId: string, taskId: string) => ({
      conversations:
        taskId === 'task-1'
          ? { stopSession: mocks.sourceStop, startSession: mocks.sourceRestart }
          : { startSession: mocks.targetStart },
    }));
    mocks.sourceStop.mockResolvedValue(undefined);
    mocks.sourceRestart.mockResolvedValue(undefined);
    mocks.targetStart.mockResolvedValue(undefined);
    mocks.stabilizePendingInitialPromptDelivery.mockResolvedValue({ config: sourceRow.config });
    mocks.mapConversation.mockImplementation((row: typeof sourceRow) => ({
      id: row.id,
      projectId: row.projectId,
      taskId: row.taskId,
      runtimeId: 'claude',
      title: row.title,
      lastInteractedAt: row.lastInteractedAt,
      isInitialConversation: row.isInitialConversation,
      resume: true,
    }));
  });

  it('stops the source session, persists the new owner, and resumes in a mounted target', async () => {
    const moved = await moveConversation('project-1', 'task-1', 'task-2', 'conversation-1');

    expect(mocks.sourceStop).toHaveBeenCalledWith('conversation-1');
    expect(mocks.targetStart).toHaveBeenCalledWith(moved, undefined, true);
    expect(moved.taskId).toBe('task-2');
    expect(mocks.hookEmit).toHaveBeenCalledWith('conversation:moved', moved, 'task-1', 'task-2');
    expect(mocks.emit).toHaveBeenCalledWith(conversationMovedChannel, {
      conversation: moved,
      sourceTaskId: 'task-1',
      targetTaskId: 'task-2',
    });
  });

  it('rejects an unavailable target before stopping the source session', async () => {
    const selectResults = [[sourceRow], [], []];
    mocks.select.mockImplementation(() => selectChain(selectResults.shift() ?? []));

    await expect(
      moveConversation('project-1', 'task-1', 'missing-task', 'conversation-1')
    ).rejects.toThrow('Target task not found or unavailable');
    expect(mocks.sourceStop).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects moving a session owned by an Agent Room member', async () => {
    const selectResults = [[sourceRow], [{ id: 'task-2' }], [{ id: 'member-1' }]];
    mocks.select.mockImplementation(() => selectChain(selectResults.shift() ?? []));

    await expect(
      moveConversation('project-1', 'task-1', 'task-2', 'conversation-1')
    ).rejects.toThrow('Agent Room member sessions cannot be moved');
    expect(mocks.sourceStop).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects an attempted pending first prompt before stopping or updating ownership', async () => {
    mocks.mapConversation.mockImplementation((row: typeof sourceRow) => ({
      id: row.id,
      projectId: row.projectId,
      taskId: row.taskId,
      runtimeId: 'codex',
      title: row.title,
      lastInteractedAt: row.lastInteractedAt,
      isInitialConversation: row.isInitialConversation,
      resume: true,
      pendingInitialPrompt: {
        prompt: 'Keep this exact first prompt',
        attemptStartedAtMs: 1_786_387_322_082,
      },
    }));

    await expect(
      moveConversation('project-1', 'task-1', 'task-2', 'conversation-1')
    ).rejects.toThrow('Resume the pending first prompt before moving this conversation.');

    expect(mocks.mapConversation).toHaveBeenCalledWith(sourceRow, true);
    expect(mocks.resolveTask).not.toHaveBeenCalled();
    expect(mocks.sourceStop).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.targetStart).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects when a first-prompt attempt wins the delivery CAS during move validation', async () => {
    mocks.stabilizePendingInitialPromptDelivery.mockResolvedValue({
      config: JSON.stringify({
        pendingInitialPrompt: { prompt: 'Keep this exact first prompt', attemptStartedAtMs: 123 },
      }),
      pendingInitialPrompt: {
        prompt: 'Keep this exact first prompt',
        attemptStartedAtMs: 123,
      },
    });

    await expect(
      moveConversation('project-1', 'task-1', 'task-2', 'conversation-1')
    ).rejects.toThrow('Resume the pending first prompt before moving this conversation.');

    expect(mocks.sourceStop).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.targetStart).not.toHaveBeenCalled();
  });

  it('restarts the source session when persisting the move fails', async () => {
    mocks.update.mockImplementation((table: unknown) => {
      expect(table).toBe(conversations);
      return {
        set: () => ({
          where: () => ({ returning: async () => Promise.reject(new Error('write failed')) }),
        }),
      };
    });

    await expect(
      moveConversation('project-1', 'task-1', 'task-2', 'conversation-1')
    ).rejects.toThrow('write failed');
    expect(mocks.sourceStop).toHaveBeenCalledWith('conversation-1');
    expect(mocks.sourceRestart).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', resume: true }),
      undefined,
      true
    );
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('does not restart from a stale snapshot when the delivery CAS wins first', async () => {
    mocks.update.mockImplementation((table: unknown) => {
      expect(table).toBe(conversations);
      return {
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      };
    });

    await expect(
      moveConversation('project-1', 'task-1', 'task-2', 'conversation-1')
    ).rejects.toThrow('Conversation moved concurrently');

    expect(mocks.sourceRestart).not.toHaveBeenCalled();
    expect(mocks.targetStart).not.toHaveBeenCalled();
  });
});
