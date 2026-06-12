import type { Issue } from '@shared/tasks';

type ResolveTaskBranchNameInput = {
  rawBranch: string;
  branchPrefix: string;
  suffix: string;
  linkedIssue?: Issue;
};

export function resolveTaskBranchName({
  rawBranch,
  branchPrefix,
  suffix,
  linkedIssue,
}: ResolveTaskBranchNameInput): string {
  const linearBranchName =
    linkedIssue?.provider === 'linear' ? linkedIssue.branchName?.trim() : undefined;

  if (linearBranchName) {
    return linearBranchName;
  }

  // Empty rawBranch means the random suffix alone names the branch (hash mode).
  const base = rawBranch ? `${rawBranch}-${suffix}` : suffix;
  return branchPrefix ? `${branchPrefix}/${base}` : base;
}
