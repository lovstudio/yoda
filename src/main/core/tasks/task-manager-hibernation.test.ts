import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveConversationSession } from '@main/core/conversations/types';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { IDLE_SESSION_HIBERNATION_CONCURRENCY, taskManager } from './task-manager';

const mocks = vi.hoisted(() => ({
  getDiagnostics: vi.fn(),
  getRuntimeStatusMonitor: vi.fn(),
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

vi.mock('@main/core/conversations/runtime-status-monitor-registry', () => ({
  runtimeStatusMonitorRegistry: {
    get: mocks.getRuntimeStatusMonitor,
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

function makeProvider(activeSessions: ActiveConversationSession[] = [session]) {
  return {
    getActiveSessions: vi.fn(() => activeSessions),
    stopSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaskProvider['conversations'];
}

describe('TaskManager idle agent hibernation revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDiagnostics.mockReturnValue({ consumerCount: 0 });
    mocks.getRuntimeStatusMonitor.mockReturnValue('terminal');
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

  it('does not stop a candidate that emits output before the stop phase', async () => {
    const provider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics
      .mockReturnValueOnce({ consumerCount: 0, lastOutputAt: 0 })
      .mockReturnValueOnce({ consumerCount: 0, lastOutputAt: Date.now() });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(60_000);

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

  it('stops an aged completed tmux identity after its renderer transport detached', async () => {
    const detachedSession: ActiveConversationSession = {
      ...session,
      transportAttached: false,
      transportDetachedAt: 0,
    };
    const provider = makeProvider([detachedSession]);
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics.mockReturnValue(null);

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).toHaveBeenCalledWith(session.conversationId);
    expect(stopped).toBe(1);
  });

  it('does not hibernate a detached identity while its replacement transport is registering', async () => {
    const detachedSession: ActiveConversationSession = {
      ...session,
      transportAttached: false,
      transportDetachedAt: 0,
    };
    const provider = makeProvider([detachedSession]);
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics.mockReturnValue({ consumerCount: 0, registering: true });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('does not hibernate while a replacement PTY is live but provider attach has not committed', async () => {
    const detachedSession: ActiveConversationSession = {
      ...session,
      transportAttached: false,
      transportDetachedAt: 0,
    };
    const provider = makeProvider([detachedSession]);
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics.mockReturnValue({ consumerCount: 0, live: true });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('stops authoritative idle sessions but keeps heuristic idle sessions alive', async () => {
    const authoritativeProvider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'idle', updatedAt: 0 });
    mocks.getRuntimeStatusMonitor.mockReturnValue('rollout');

    const authoritativeStopped =
      await managerWith(authoritativeProvider).hibernateIdleAgentSessions(1);

    expect(authoritativeProvider.stopSession).toHaveBeenCalledOnce();
    expect(authoritativeStopped).toBe(1);

    const heuristicProvider = makeProvider();
    mocks.getRuntimeStatusMonitor.mockReturnValue('terminal');

    const heuristicStopped = await managerWith(heuristicProvider).hibernateIdleAgentSessions(1);

    expect(heuristicProvider.stopSession).not.toHaveBeenCalled();
    expect(heuristicStopped).toBe(0);
  });

  it('keeps a session alive when PTY output is newer than its completed status', async () => {
    const provider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics.mockReturnValue({
      consumerCount: 0,
      lastOutputAt: Date.now(),
    });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(60_000);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('keeps a session alive when PTY input is newer than its completed status', async () => {
    const provider = makeProvider();
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });
    mocks.getDiagnostics.mockReturnValue({
      consumerCount: 0,
      lastInputAt: Date.now(),
    });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(60_000);

    expect(provider.stopSession).not.toHaveBeenCalled();
    expect(stopped).toBe(0);
  });

  it('coalesces overlapping hibernation sweeps into one stop pass', async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const provider = makeProvider();
    provider.stopSession = vi.fn(() => stopGate);
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });

    const first = managerWith(provider).hibernateIdleAgentSessions(1);
    const second = managerWith(provider).hibernateIdleAgentSessions(1);
    await vi.waitFor(() => expect(provider.stopSession).toHaveBeenCalledOnce());

    expect(second).toBe(first);
    releaseStop();
    await Promise.all([first, second]);
    expect(provider.stopSession).toHaveBeenCalledOnce();
  });

  it('bounds concurrent stop and revalidation work', async () => {
    const sessions = Array.from(
      { length: IDLE_SESSION_HIBERNATION_CONCURRENCY * 2 + 1 },
      (_, index): ActiveConversationSession => ({
        ...session,
        conversationId: `conversation-${index}`,
        sessionId: `agent:project-1:task-1:conversation-${index}`,
      })
    );
    let active = 0;
    let maxActive = 0;
    const provider = makeProvider(sessions);
    provider.stopSession = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    mocks.getState.mockReturnValue({ status: 'completed', updatedAt: 0 });

    const stopped = await managerWith(provider).hibernateIdleAgentSessions(1);

    expect(stopped).toBe(sessions.length);
    expect(maxActive).toBe(IDLE_SESSION_HIBERNATION_CONCURRENCY);
  });
});
