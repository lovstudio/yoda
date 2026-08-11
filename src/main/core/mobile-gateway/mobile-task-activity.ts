import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import type { MobileTaskActivityStatus } from '@shared/mobile-api';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { ActiveRuntimeStatusSnapshot } from '@main/core/conversations/getActiveRuntimeStatuses';

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\0${taskId}`;
}

export function resolveTaskActivityStatus(
  task: Task,
  runtimeStatuses: AgentSessionRuntimeStatus[],
  bootstrapStatus: TaskBootstrapStatus
): MobileTaskActivityStatus {
  if (bootstrapStatus.status === 'bootstrapping') return 'bootstrapping';
  if (bootstrapStatus.status === 'error') return 'error';
  if (runtimeStatuses.includes('working')) return 'working';
  if (runtimeStatuses.includes('awaiting-input')) return 'awaiting-input';
  if (runtimeStatuses.includes('error')) return 'error';
  if (task.status === 'review' || task.needsReview) return 'review';
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'todo') return 'todo';
  if (runtimeStatuses.includes('completed')) return 'completed';
  return 'idle';
}

type ResolveMobileTaskActivityStatusesOptions = {
  tasks: Task[];
  loadBatch: () => Promise<ActiveRuntimeStatusSnapshot>;
  loadFallback: (task: Task) => Promise<MobileTaskActivityStatus>;
  getBootstrapStatus: (taskId: string) => TaskBootstrapStatus;
  onBatchError?: (error: unknown) => void;
};

/**
 * Uses the authoritative local runtime inventory where it is complete. Projects
 * outside that coverage (for example SSH) retain the existing per-task lookup.
 * A failed batch is never treated as an empty inventory: every task falls back.
 */
export async function resolveMobileTaskActivityStatuses({
  tasks,
  loadBatch,
  loadFallback,
  getBootstrapStatus,
  onBatchError,
}: ResolveMobileTaskActivityStatusesOptions): Promise<Map<string, MobileTaskActivityStatus>> {
  if (tasks.length === 0) return new Map();

  let batch: ActiveRuntimeStatusSnapshot;
  try {
    batch = await loadBatch();
  } catch (error) {
    onBatchError?.(error);
    return resolveFallbackStatuses(tasks, loadFallback);
  }

  const coveredProjectIds = new Set(batch.coveredProjectIds);
  const runtimeStatusesByTask = new Map<string, AgentSessionRuntimeStatus[]>();
  for (const entry of batch.entries) {
    const key = taskKey(entry.projectId, entry.taskId);
    const statuses = runtimeStatusesByTask.get(key) ?? [];
    statuses.push(entry.status);
    runtimeStatusesByTask.set(key, statuses);
  }

  const statuses = new Map<string, MobileTaskActivityStatus>();
  const fallbackTasks: Task[] = [];
  for (const task of tasks) {
    if (!coveredProjectIds.has(task.projectId)) {
      fallbackTasks.push(task);
      continue;
    }

    statuses.set(
      task.id,
      resolveTaskActivityStatus(
        task,
        runtimeStatusesByTask.get(taskKey(task.projectId, task.id)) ?? [],
        getBootstrapStatus(task.id)
      )
    );
  }

  for (const [taskId, status] of await resolveFallbackStatuses(fallbackTasks, loadFallback)) {
    statuses.set(taskId, status);
  }
  return statuses;
}

async function resolveFallbackStatuses(
  tasks: Task[],
  loadFallback: (task: Task) => Promise<MobileTaskActivityStatus>
): Promise<Map<string, MobileTaskActivityStatus>> {
  return new Map(
    await Promise.all(tasks.map(async (task) => [task.id, await loadFallback(task)] as const))
  );
}
