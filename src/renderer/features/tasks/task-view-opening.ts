import type { TaskViewKind } from './stores/task-selectors';

type TaskLoadState = 'idle' | 'loading' | 'loaded' | 'error' | undefined;

export const TASK_OPENING_MESSAGE_KEY = 'tasks.settingUpWorkspace' as const;

/**
 * All transient states of one task entry share one visual surface. In
 * particular, a lazy task can pass through `missing` while its project mounts
 * and its task record is point-loaded; that is not a user-visible "missing
 * task" result yet.
 */
export function stableTaskOpeningMessageKey(
  kind: TaskViewKind,
  {
    hasProject,
    taskLoadState,
    isTaskLoadPending,
    isTargetPending = false,
  }: {
    hasProject: boolean;
    taskLoadState: TaskLoadState;
    isTaskLoadPending: boolean;
    isTargetPending?: boolean;
  }
): typeof TASK_OPENING_MESSAGE_KEY | null {
  // Provisioning publishes the ready store before the task opener can commit
  // its restored conversation target. Keep the same opening surface across
  // that boundary so the ready layout never paints a false overview/empty state.
  if (isTargetPending) return TASK_OPENING_MESSAGE_KEY;

  switch (kind) {
    case 'project-mounting':
    case 'creating':
    case 'naming':
    case 'provisioning':
    case 'teardown':
    case 'idle':
      return TASK_OPENING_MESSAGE_KEY;
    case 'missing':
      // A missing row only becomes a terminal result after the mounted
      // project's task snapshot (or its point load) has settled.
      return hasProject &&
        (isTaskLoadPending || (taskLoadState !== 'loaded' && taskLoadState !== 'error'))
        ? TASK_OPENING_MESSAGE_KEY
        : null;
    default:
      return null;
  }
}
