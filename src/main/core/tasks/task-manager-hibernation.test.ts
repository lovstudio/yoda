import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveConversationSession } from '@main/core/conversations/types';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { taskManager } from './task-manager';

const mocks = vi.hoisted(() => ({
  getDiagnostics: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    getState: mocks.getState,
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    getDiagnostics: mocks.getDiagnostics,
  },
}));

vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIdPages: vi.fn(async function* () {}),
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { release: vi.fn() },
}));

vi.mock('@main/db/client', () => ({ db: {}, sqlite: {} }));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const session: ActiveConversationSession = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  sessionId: 'agent:project-1:task-1:conversation-1',
  runtimeId: 'codex',
  title: 'Codex',
  detachable: true,
};

function managerWith(provider: TaskProvider['conversations']): typeof taskManager {
  const lifecycle = {
    values: () => [
      {
        taskName: 'Task 1',
        taskProvider: { conversations: provider },
      },
    ],
  };
  (
    taskManager as unknown as {
      _lifecycle: typeof lifecycle;
    }
  )._lifecycle = lifecycle;
  return taskManager;
}

function makeProvider() {
  return {
    getActiveSessions: vi.fn(() => [session]),
    stopSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaskProvider['conversations'];
}

describe('TaskManager idle agent hibernation revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDiagnostics.mockReturnValue({ consumerCount: 0 });
  });

  it('does not stop a candidate that starts working before the stop phase', async () => {
    const provider = makeProvider();
    mocks.getState
      .mockReturnValueOnce({ status: 'completed', updatedAt: 0 })
      .mockReturnValueOnce({ status: 'working', updatedAt: Date.now() });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('does not stop a candidate that gains a renderer consumer', async () => {
    const provider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics
      .mockReturnValueOnce({ consumerCount: 0 })
      .mockReturnValueOnce({ consumerCount: 1 });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('stops and counts a session that is still completed and unobserved', async () => {
    const provider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).toHaveBeenCalledOnce();
    expect(provider.stopSession).toHaveBeenCalledWith(session.conversationId);
    expect(stopped).toBe(1);
  });
});
