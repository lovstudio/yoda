import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import type { Task } from '@shared/tasks';
import {
  resolveMobileTaskActivityStatuses,
  resolveTaskActivityStatus,
} from './mobile-task-activity';

describe('resolveMobileTaskActivityStatuses', () => {
  it('uses grouped batch entries for covered projects and falls back only for uncovered ones', async () => {
    const localWorking = task('local-working', 'local-project');
    const localIdle = task('local-idle', 'local-project');
    const remoteAwaiting = task('remote-awaiting', 'remote-project');
    const tasks = [localWorking, localIdle, remoteAwaiting];
    const fallbackRuntimeStatuses = new Map<string, AgentSessionRuntimeStatus[]>([
      [localWorking.id, ['working', 'error']],
      [localIdle.id, []],
      [remoteAwaiting.id, ['awaiting-input']],
    ]);
    const loadFallback = vi.fn(async (candidate: Task) =>
      resolveTaskActivityStatus(candidate, fallbackRuntimeStatuses.get(candidate.id) ?? [], {
        status: 'ready',
      })
    );

    const batched = await resolveMobileTaskActivityStatuses({
      tasks,
      loadBatch: async () => ({
        coveredProjectIds: ['local-project'],
        entries: [
          {
            projectId: 'local-project',
            taskId: localWorking.id,
            conversationId: 'conversation-error',
            status: 'error',
          },
          {
            projectId: 'local-project',
            taskId: localWorking.id,
            conversationId: 'conversation-working',
            status: 'working',
          },
        ],
      }),
      loadFallback,
      getBootstrapStatus: () => ({ status: 'ready' }),
    });

    expect(batched).toEqual(
      new Map([
        [localWorking.id, 'working'],
        [localIdle.id, 'idle'],
        [remoteAwaiting.id, 'awaiting-input'],
      ])
    );
    expect(loadFallback).toHaveBeenCalledOnce();
    expect(loadFallback).toHaveBeenCalledWith(remoteAwaiting);

    loadFallback.mockClear();
    const onBatchError = vi.fn();
    const failedBatch = await resolveMobileTaskActivityStatuses({
      tasks,
      loadBatch: async () => {
        throw new Error('batch unavailable');
      },
      loadFallback,
      getBootstrapStatus: () => ({ status: 'ready' }),
      onBatchError,
    });

    expect(failedBatch).toEqual(batched);
    expect(loadFallback).toHaveBeenCalledTimes(tasks.length);
    expect(onBatchError).toHaveBeenCalledOnce();
  });
});

function task(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    name: id,
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    statusChangedAt: '2026-08-10T00:00:00.000Z',
    isPinned: false,
    isFavorite: false,
    isLongTerm: false,
    needsReview: false,
    isUserNamed: true,
    setupStatus: 'ready',
    prs: [],
    conversations: { codex: 1 },
  };
}
