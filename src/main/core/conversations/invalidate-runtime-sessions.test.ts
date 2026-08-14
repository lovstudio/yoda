import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateRuntimeSessions } from './invalidate-runtime-sessions';

const mocks = vi.hoisted(() => ({
  getAgentSessions: vi.fn(),
  selectRows: vi.fn(),
  resolveTask: vi.fn(),
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: { getAgentSessions: mocks.getAgentSessions },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: mocks.selectRows })),
    })),
  },
}));

vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));

describe('invalidateRuntimeSessions', () => {
  const stopSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stopSession.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({ conversations: { stopSession } });
    mocks.getAgentSessions.mockReturnValue([
      {
        sessionId: 'project:task:maas',
        conversationId: 'maas',
        projectId: 'project',
        taskId: 'task',
        runtimeId: 'codex',
      },
      {
        sessionId: 'project:task:subscription',
        conversationId: 'subscription',
        projectId: 'project',
        taskId: 'task',
        runtimeId: 'codex',
      },
      {
        sessionId: 'project:task:claude',
        conversationId: 'claude',
        projectId: 'project',
        taskId: 'task',
        runtimeId: 'claude',
      },
    ]);
    mocks.selectRows.mockResolvedValue([
      { id: 'maas', authProvider: 'yoda-maas' },
      { id: 'subscription', authProvider: 'official-subscription' },
    ]);
  });

  it('stops only matching runtime sessions launched with the stale account mode', async () => {
    await expect(
      invalidateRuntimeSessions({
        runtimeIds: ['codex'],
        authProviders: ['yoda-maas'],
        reason: 'credential changed',
      })
    ).resolves.toBe(1);

    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(stopSession).toHaveBeenCalledWith('maas');
  });

  it('stops every matching runtime session when routing changes', async () => {
    await expect(
      invalidateRuntimeSessions({ runtimeIds: ['codex'], reason: 'route changed' })
    ).resolves.toBe(2);

    expect(stopSession).toHaveBeenCalledTimes(2);
    expect(stopSession).toHaveBeenCalledWith('maas');
    expect(stopSession).toHaveBeenCalledWith('subscription');
  });
});
