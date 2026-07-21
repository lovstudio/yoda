import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { createUnprovisionedTask } from './task';
import { summarizeTaskSessionStatuses, taskSessionStatusSummary } from './task-selectors';

const mocks = vi.hoisted(() => ({
  taskSessionStatuses: vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    agentRuntime: {
      taskSessionStatuses: mocks.taskSessionStatuses,
    },
  },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
  rpc: {},
}));

describe('taskSessionStatusSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskSessionStatuses.mockReturnValue([]);
  });

  it('surfaces awaiting-input from global runtime state for unmounted sidebar tasks', () => {
    mocks.taskSessionStatuses.mockReturnValue([
      { conversationId: 'conversation-1', status: 'awaiting-input' },
    ]);

    expect(taskSessionStatusSummary(createUnprovisionedTask(makeTask())).primaryStatus).toBe(
      'awaiting-input'
    );
  });

  it('only surfaces terminal attention states when the task is unread', () => {
    mocks.taskSessionStatuses.mockReturnValue([]);

    expect(taskSessionStatusSummary(createUnprovisionedTask(makeTask())).primaryStatus).toBeNull();

    mocks.taskSessionStatuses.mockReturnValue([
      { conversationId: 'conversation-1', status: 'completed' },
    ]);

    expect(taskSessionStatusSummary(createUnprovisionedTask(makeTask())).primaryStatus).toBe(
      'completed'
    );
  });
});

describe('summarizeTaskSessionStatuses', () => {
  it('preserves every session while prioritizing attention over running work', () => {
    const summary = summarizeTaskSessionStatuses([
      { conversationId: 'working-1', status: 'working' },
      { conversationId: 'completed-1', status: 'completed' },
      { conversationId: 'awaiting-1', status: 'awaiting-input' },
      { conversationId: 'error-1', status: 'error' },
      { conversationId: 'working-2', status: 'working' },
    ]);

    expect(summary.primaryStatus).toBe('awaiting-input');
    expect(summary.totalCount).toBe(5);
    expect(summary.attentionCount).toBe(3);
    expect(summary.workingCount).toBe(2);
    expect(summary.sessions.map(({ conversationId }) => conversationId)).toEqual([
      'awaiting-1',
      'error-1',
      'completed-1',
      'working-1',
      'working-2',
    ]);
  });

  it('uses the latest interaction first within one status', () => {
    const summary = summarizeTaskSessionStatuses([
      {
        conversationId: 'older',
        status: 'working',
        lastInteractedAt: '2026-07-18T10:00:00.000Z',
      },
      {
        conversationId: 'newer',
        status: 'working',
        lastInteractedAt: '2026-07-19T10:00:00.000Z',
      },
    ]);

    expect(summary.sessions.map(({ conversationId }) => conversationId)).toEqual([
      'newer',
      'older',
    ]);
  });
});

function makeTask(): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task',
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: '2026-06-09T10:00:00.000Z',
    updatedAt: '2026-06-09T10:00:00.000Z',
    statusChangedAt: '2026-06-09T10:00:00.000Z',
    lastInteractedAt: '2026-06-09T10:00:00.000Z',
    isPinned: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
