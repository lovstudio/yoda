import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingInitialPrompt,
  recordPendingInitialPromptAttempt,
  stabilizePendingInitialPromptDelivery,
} from './pending-initial-prompt-store';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  sqlitePrepare: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
  sqlite: { prepare: mocks.sqlitePrepare },
}));

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

describe('pending initial prompt store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sqliteRun.mockReturnValue({ changes: 1 });
    mocks.sqlitePrepare.mockReturnValue({ run: mocks.sqliteRun });
  });

  it('records an attempt with compare-and-swap while preserving config', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          config: JSON.stringify({
            permissionMode: 'bypass',
            pendingInitialPrompt: { prompt: 'Deliver me once' },
          }),
        },
      ])
    );

    await expect(
      recordPendingInitialPromptAttempt('conversation-1', 123, {
        projectId: 'project-1',
        taskId: 'task-1',
        stateRoot: '/state/codex-a',
        cwd: '/workspace',
      })
    ).resolves.toEqual({
      prompt: 'Deliver me once',
      attemptStartedAtMs: 123,
      attemptStateRoot: '/state/codex-a',
      attemptCwd: '/workspace',
    });

    const [config] = mocks.sqliteRun.mock.calls[0] as [string];
    expect(JSON.parse(config)).toEqual({
      permissionMode: 'bypass',
      pendingInitialPrompt: {
        prompt: 'Deliver me once',
        attemptStartedAtMs: 123,
        attemptStateRoot: '/state/codex-a',
        attemptCwd: '/workspace',
      },
    });
  });

  it('clears only the pending marker through a compare-and-swap write', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          config: JSON.stringify({
            permissionMode: 'bypass',
            pendingInitialPrompt: { prompt: 'Deliver me once', attemptStartedAtMs: 123 },
          }),
        },
      ])
    );

    await clearPendingInitialPrompt('conversation-1', {
      projectId: 'project-1',
      taskId: 'task-1',
    });

    const [config] = mocks.sqliteRun.mock.calls[0] as [string];
    expect(JSON.parse(config)).toEqual({ permissionMode: 'bypass' });
  });

  it('rotates the delivery token before ownership-changing operations', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          archivedAt: null,
          config: JSON.stringify({
            permissionMode: 'bypass',
            pendingInitialPrompt: { prompt: 'Deliver me once' },
          }),
        },
      ])
    );

    const stabilized = await stabilizePendingInitialPromptDelivery(
      'conversation-1',
      'project-1',
      'task-1'
    );

    expect(stabilized?.pendingInitialPrompt).toEqual({
      prompt: 'Deliver me once',
      deliveryToken: expect.any(String),
    });
    const [config, , conversationId, projectId, taskId] = mocks.sqliteRun.mock.calls[0] as [
      string,
      string,
      string,
      string,
      string,
    ];
    expect(JSON.parse(config).pendingInitialPrompt).toEqual(stabilized?.pendingInitialPrompt);
    expect({ conversationId, projectId, taskId }).toEqual({
      conversationId: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
    });
  });

  it('rejects a stale delivery token before recording an attempt', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          config: JSON.stringify({
            pendingInitialPrompt: { prompt: 'Deliver me once', deliveryToken: 'new-token' },
          }),
        },
      ])
    );

    await expect(
      recordPendingInitialPromptAttempt(
        'conversation-1',
        123,
        { projectId: 'project-1', taskId: 'task-1' },
        'stale-token'
      )
    ).resolves.toBeUndefined();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('does not clear a pending prompt owned by a newer delivery token', async () => {
    mocks.select.mockReturnValue(
      selectChain([
        {
          config: JSON.stringify({
            pendingInitialPrompt: { prompt: 'Deliver me once', deliveryToken: 'new-token' },
          }),
        },
      ])
    );

    await expect(
      clearPendingInitialPrompt('conversation-1', {
        projectId: 'project-1',
        taskId: 'task-1',
        deliveryToken: 'stale-token',
      })
    ).resolves.toBe(false);
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });
});
