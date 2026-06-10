import type { CreateConversationParams } from '@shared/conversations';
import type { ProvisionStep } from '@shared/events/taskEvents';
import type { Branch, CreateBranchError, FetchPrForReviewError, PushError } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';

export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
export type TaskSetupStatus = 'ready' | 'pending' | 'naming_failed' | 'branch_failed';

export type Issue = {
  provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'featurebase';
  url: string;
  title: string;
  identifier: string;
  description?: string;
  branchName?: string;
  status?: string;
  assignees?: string[];
  project?: string;
  updatedAt?: string;
  fetchedAt?: string;
};

export type Task = {
  id: string;
  projectId: string;
  name: string;
  status: TaskLifecycleStatus;
  sourceBranch: Branch | undefined;
  taskBranch?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp: when lifecycle status last changed (current status entered). */
  statusChangedAt: string;
  archivedAt?: string;
  archiveNote?: string;
  lastInteractedAt?: string;
  /** All issues linked to this task. New code should prefer this over linkedIssue. */
  linkedIssues?: Issue[];
  /** @deprecated Use linkedIssues. Preserved as the primary linked issue for compatibility. */
  linkedIssue?: Issue;
  isPinned: boolean;
  needsReview: boolean;
  isUserNamed: boolean;
  setupStatus: TaskSetupStatus;
  setupError?: string;
  setupRequiresBranchName?: boolean;
  prs: PullRequest[];
  conversations: Record<string, number>;
  workspaceProvider?: 'byoi';
  workspaceId?: string;
  workspaceProviderData?: string; // JSON, BYOI only
  /** Sidebar workspace (grouping tab). Distinct from the agent-runtime `workspaceId`. */
  sidebarWorkspaceId?: string;
};

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type CreateTaskStrategy =
  | { kind: 'new-branch'; taskBranch: string; pushBranch?: boolean }
  | { kind: 'checkout-existing' }
  | {
      kind: 'from-pull-request';
      prNumber: number;
      /** The PR's headRefName, used as the local branch name (same as `gh pr checkout`). */
      headBranch: string;
      headRepositoryUrl: string;
      isFork: boolean;
      taskBranch?: string;
      pushBranch?: boolean;
    }
  | { kind: 'no-worktree' };

export function createTaskStrategyRequiresBranchName(strategy: CreateTaskStrategy): boolean {
  return (
    strategy.kind === 'new-branch' ||
    (strategy.kind === 'from-pull-request' && Boolean(strategy.taskBranch))
  );
}

export type CreateTaskParams = {
  id: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from (not used for `from-pull-request` strategy) */
  sourceBranch: Branch;
  /** Controls branch creation, worktree setup, and git fetch strategy */
  strategy: CreateTaskStrategy;
  /** The issue to link to the task */
  linkedIssue?: Issue;
  /**  */
  initialConversation?: CreateConversationParams;
  initialStatus?: TaskLifecycleStatus;
  workspaceProvider?: 'byoi';
  /**
   * Sidebar workspace to assign the new task to (projectless/Drafts tasks only —
   * tasks in a real project inherit the project's workspace in the sidebar).
   */
  sidebarWorkspaceId?: string;
};

export type CreateTaskError =
  | { type: 'project-not-found' }
  | { type: 'initial-commit-required'; branch: string }
  | { type: 'branch-create-failed'; branch: string; error: CreateBranchError }
  | { type: 'pr-fetch-failed'; error: FetchPrForReviewError; remote: string }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'provision-failed'; message: string }
  | { type: 'provision-timeout'; timeoutMs: number; step: ProvisionStep | null };

export type CreateTaskWarning =
  | {
      type: 'branch-publish-failed';
      branch: string;
      remote: string;
      error: PushError;
    }
  | {
      type: 'task-naming-failed';
      message: string;
      blocksProvision: boolean;
    }
  | {
      type: 'branch-setup-failed';
      branch: string;
      message: string;
    };

export type CreateTaskSuccess = {
  task: Task;
  warning?: CreateTaskWarning;
};

export type ProvisionTaskResult = {
  path: string;
  workspaceId: string;
};

export function formatIssueAsPrompt(issue: Issue, initialPrompt?: string): string {
  const parts = [`[${issue.identifier}] ${issue.title}`, issue.url, issue.description].filter(
    Boolean
  );

  if (initialPrompt?.trim()) parts.push('', initialPrompt.trim());
  return parts.join('\n');
}
