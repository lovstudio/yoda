import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import type { ProjectProvider, ProvisionResult } from '@main/core/projects/project-provider';
import { TASK_TIMEOUT_MS } from './provision-task-error';
import { TaskManager } from './task-manager';

const mocks = vi.hoisted(() => ({
  provisionLocalTask: vi.fn(),
  releaseWorkspace: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/core/tasks/task-builder', () => ({
  provisionLocalTask: mocks.provisionLocalTask,
}));

vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIdPages: vi.fn(async function* () {}),
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    release: mocks.releaseWorkspace,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {},
  sqlite: {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: mocks.error,
    info: mocks.info,
    warn: mocks.warn,
  },
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function makeTask(): Task {
  return {
    id: 'task-timeout',
    projectId: 'project-1',
    name: 'Slow task',
    status: 'in_progress',
    sourceBranch: undefined,
    taskBranch: 'slow-task',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    isPinned: false,
    isLongTerm: false,
    needsReview: false,
    isUserNamed: true,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.releaseWorkspace.mockResolvedValue(undefined);
});

describe('TaskManager provision timeout cleanup', () => {
  it('observes the original provision once and terminates a late success', async () => {
    vi.useFakeTimers();
    const lateProvision = deferred<{
      provisionResult: ProvisionResult;
      workspace: unknown;
    }>();
    const nextProvision = deferred<{
      provisionResult: ProvisionResult;
      workspace: unknown;
    }>();
    const conversations = { destroyAll: vi.fn().mockResolvedValue(undefined) };
    const terminals = { destroyAll: vi.fn().mockResolvedValue(undefined) };
    const provisionResult = {
      taskProvider: { conversations, terminals },
      persistData: { workspaceId: 'workspace-late' },
    } as unknown as ProvisionResult;
    const nextProvisionResult = {
      taskProvider: {
        conversations: { destroyAll: vi.fn().mockResolvedValue(undefined) },
        terminals: { destroyAll: vi.fn().mockResolvedValue(undefined) },
      },
      persistData: { workspaceId: 'workspace-current' },
    } as unknown as ProvisionResult;
    mocks.provisionLocalTask
      .mockReturnValueOnce(lateProvision.promise)
      .mockReturnValueOnce(nextProvision.promise);

    const provider = {
      projectId: 'project-1',
      type: 'ssh',
      repoPath: '/repo',
      defaultWorkspaceType: {
        kind: 'ssh',
        connectionId: 'connection-1',
      },
      ctx: {},
      settings: {},
    } as unknown as ProjectProvider;
    const manager = new TaskManager();
    const provisionedHook = vi.fn();
    manager.hooks.on('task:provisioned', provisionedHook);

    const resultPromise = manager.provisionTask(provider, makeTask(), [], []);
    await flushMicrotasks();
    expect(mocks.provisionLocalTask).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS);
    const timeoutResult = await resultPromise;
    expect(timeoutResult).toMatchObject({
      success: false,
      error: { type: 'timeout', timeout: TASK_TIMEOUT_MS },
    });
    expect(manager.getTask('task-timeout')).toBeUndefined();
    expect(mocks.provisionLocalTask).toHaveBeenCalledOnce();

    const blockedRetry = await manager.provisionTask(provider, makeTask(), [], []);
    expect(blockedRetry).toEqual(timeoutResult);
    expect(mocks.provisionLocalTask).toHaveBeenCalledOnce();

    lateProvision.resolve({ provisionResult, workspace: {} });
    await flushMicrotasks();

    expect(mocks.provisionLocalTask).toHaveBeenCalledOnce();
    expect(conversations.destroyAll).toHaveBeenCalledOnce();
    expect(terminals.destroyAll).toHaveBeenCalledOnce();
    expect(mocks.releaseWorkspace).toHaveBeenCalledWith('workspace-late', 'terminate');
    expect(provisionedHook).not.toHaveBeenCalled();
    expect(manager.getTask('task-timeout')).toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith(
      'TaskManager: provision completed after timeout; terminating late result',
      expect.objectContaining({
        taskId: 'task-timeout',
        workspaceId: 'workspace-late',
      })
    );
    expect(mocks.info).toHaveBeenCalledWith(
      'TaskManager: cleaned up provision result that completed after timeout',
      expect.objectContaining({ taskId: 'task-timeout' })
    );

    const allowedRetry = manager.provisionTask(provider, makeTask(), [], []);
    await flushMicrotasks();
    expect(mocks.provisionLocalTask).toHaveBeenCalledTimes(2);
    nextProvision.resolve({ provisionResult: nextProvisionResult, workspace: {} });
    await expect(allowedRetry).resolves.toMatchObject({
      success: true,
      data: { persistData: { workspaceId: 'workspace-current' } },
    });
  });
});
