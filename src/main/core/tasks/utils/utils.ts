import type { PullRequest } from '@shared/pull-requests';
import {
  createTaskStrategyRequiresBranchName,
  type CreateTaskParams,
  type Issue,
  type Task,
  type TaskLifecycleStatus,
} from '@shared/tasks';
import type { TaskRow } from '@main/db/schema';
import { fromStoredBranch } from '../stored-branch';

function setupRequiresBranchName(setupData: string | null): boolean {
  if (!setupData) return false;
  try {
    const parsed = JSON.parse(setupData) as { params?: Pick<CreateTaskParams, 'strategy'> };
    return parsed.params?.strategy
      ? createTaskStrategyRequiresBranchName(parsed.params.strategy)
      : false;
  } catch {
    return false;
  }
}

export function mapTaskRowToTask(
  row: TaskRow,
  prs: PullRequest[] = [],
  conversations: Record<string, number> = {},
  linkedIssues?: Issue[]
): Task {
  const sourceBranch = row.sourceBranch ? fromStoredBranch(row.sourceBranch) : undefined;
  const legacyIssue = row.linkedIssue ? (JSON.parse(row.linkedIssue) as Issue) : undefined;
  const issues = linkedIssues?.length ? linkedIssues : legacyIssue ? [legacyIssue] : [];
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as TaskLifecycleStatus,
    sourceBranch,
    taskBranch: row.taskBranch ?? undefined,
    linkedIssues: issues,
    linkedIssue: issues[0],
    archivedAt: row.archivedAt ?? undefined,
    archiveNote: row.archiveNote ?? undefined,
    archiveRequestedAt: row.archiveRequestedAt ?? undefined,
    lastInteractedAt: row.lastInteractedAt ?? undefined,
    createdAt: row.createdAt,
    prs,
    conversations,
    updatedAt: row.updatedAt,
    statusChangedAt: row.statusChangedAt,
    isPinned: row.isPinned === 1,
    isLongTerm: row.isLongTerm === 1,
    needsReview: row.needsReview === 1,
    isUserNamed: row.isUserNamed === 1,
    setupStatus: (row.setupStatus as Task['setupStatus']) ?? 'ready',
    setupError: row.setupError ?? undefined,
    setupRequiresBranchName: setupRequiresBranchName(row.setupData),
    workspaceProvider: (row.workspaceProvider as 'byoi') ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    workspaceProviderData: row.workspaceProviderData ?? undefined,
    sidebarWorkspaceId: row.sidebarWorkspaceId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
  };
}
