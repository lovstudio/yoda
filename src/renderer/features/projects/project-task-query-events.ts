import {
  taskArchivedChannel,
  taskCreatedChannel,
  taskDeletedChannel,
  taskMovedChannel,
  taskRenamedChannel,
  taskRestoredChannel,
} from '@shared/events/taskEvents';
import { events } from '@renderer/lib/ipc';

export const PROJECT_TASK_COUNTS_QUERY_KEY = ['projectTaskCounts'] as const;
export const projectSessionsQueryKey = (projectId: string) =>
  ['project-sessions', projectId] as const;

export function subscribeProjectTaskQueryInvalidation(callbacks: {
  onTaskCountsInvalidated?: () => void;
  onProjectSessionsInvalidated?: (projectId: string) => void;
}): () => void {
  const disposers = [
    events.on(taskCreatedChannel, () => callbacks.onTaskCountsInvalidated?.()),
    events.on(taskArchivedChannel, ({ projectId }) => {
      callbacks.onTaskCountsInvalidated?.();
      callbacks.onProjectSessionsInvalidated?.(projectId);
    }),
    events.on(taskRestoredChannel, ({ projectId }) => {
      callbacks.onTaskCountsInvalidated?.();
      callbacks.onProjectSessionsInvalidated?.(projectId);
    }),
    events.on(taskDeletedChannel, ({ projectId }) => {
      callbacks.onTaskCountsInvalidated?.();
      callbacks.onProjectSessionsInvalidated?.(projectId);
    }),
    events.on(taskRenamedChannel, ({ projectId }) => {
      callbacks.onProjectSessionsInvalidated?.(projectId);
    }),
    events.on(taskMovedChannel, ({ sourceProjectId, targetProjectId }) => {
      callbacks.onTaskCountsInvalidated?.();
      callbacks.onProjectSessionsInvalidated?.(sourceProjectId);
      callbacks.onProjectSessionsInvalidated?.(targetProjectId);
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
