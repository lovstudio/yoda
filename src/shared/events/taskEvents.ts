import { defineEvent } from '@shared/ipc/events';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import type { PullRequest } from '@shared/pull-requests';
import type { TaskNamingSnapshot } from '@shared/task-naming';

/** Emitted after a task created outside the current renderer has reached a
 * stable persisted state. Renderers use this as an invalidation and refetch
 * the canonical task snapshot so mobile-created tasks appear immediately. */
export const taskCreatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
}>('task:created');

export const taskStatusUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  status: string;
}>('task:status-updated');

/**
 * Emitted when the paradigm driving a task changes — a paradigm was injected into
 * an existing task, or an orchestration claimed one. Task lists render from the
 * stamp, so without this a badge would only appear after a reload.
 */
export const taskParadigmUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  paradigm: ParadigmStamp;
}>('task:paradigm-updated');

/** Emitted by the main process when a task finishes archiving — including
 *  archives that complete after the initiating renderer reloaded. */
export const taskArchivedChannel = defineEvent<{
  taskId: string;
  projectId: string;
}>('task:archived');

/** One event per restore operation, including its cascaded descendants. */
export const taskRestoredChannel = defineEvent<{
  restoredTaskIds: string[];
  projectId: string;
}>('task:restored');

export const taskDeletedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  parentTaskId?: string;
}>('task:deleted');

export const taskMovedChannel = defineEvent<{
  taskId: string;
  sourceProjectId: string;
  targetProjectId: string;
}>('task:moved');

export const taskRenamedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  name: string;
  isUserNamed: boolean;
}>('task:renamed');

export const taskNamingUpdatedChannel = defineEvent<TaskNamingSnapshot>('task:naming-updated');

export const taskPrUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  workspaceId: string;
  prs: PullRequest[];
}>('task:pr-updated');

export type ProvisionStep =
  | 'resolving-worktree'
  | 'initialising-workspace'
  | 'running-provision-script'
  | 'connecting'
  | 'setting-up-workspace'
  | 'starting-sessions';

export const taskProvisionProgressChannel = defineEvent<{
  taskId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
}>('task:provision-progress');
