import type { AgentSessionRuntimeStatus } from './events/agentEvents';
import type { RuntimeId } from './runtime-registry';
import type { TaskLifecycleStatus } from './tasks';

/** Board columns, in display order. `cancelled` and archived tasks stay off the board. */
export const KANBAN_STATUSES = [
  'todo',
  'in_progress',
  'review',
  'done',
] as const satisfies readonly TaskLifecycleStatus[];

export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export function isKanbanStatus(status: TaskLifecycleStatus): status is KanbanStatus {
  return (KANBAN_STATUSES as readonly TaskLifecycleStatus[]).includes(status);
}

export type TaskPreviewSession = {
  id: string;
  title: string | null;
  runtimeId: RuntimeId;
  status: AgentSessionRuntimeStatus | null;
};

/** Read-only task snapshot shown in the kanban card hover preview. */
export type TaskPreview = {
  /** Latest session's stored summary (markdown). Never generated on demand. */
  summary: string | null;
  diff: { additions: number; deletions: number; source: 'live' | 'snapshot' | 'none' };
  sessions: TaskPreviewSession[];
  lastInteractedAt: string | null;
};
