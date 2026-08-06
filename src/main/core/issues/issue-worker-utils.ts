import type { Branch, BranchesPayload } from '@shared/git';
import type { Issue } from '@shared/tasks';

export function resolveIssueWorkerSourceBranch(
  payload: BranchesPayload,
  preferredRef?: string
): Branch | null {
  if (payload.isUnborn) return null;

  if (preferredRef) {
    const preferred = payload.branches.find((branch) => {
      if (branch.type === 'remote') {
        return (
          branch.branch === preferredRef ||
          `${branch.remote.name}/${branch.branch}` === preferredRef
        );
      }
      return branch.branch === preferredRef;
    });
    if (preferred) return preferred;
  }

  const localDefault = payload.branches.find(
    (branch) => branch.type === 'local' && branch.branch === payload.gitDefaultBranch
  );
  if (localDefault) return { type: 'local', branch: localDefault.branch };

  const remoteDefault = payload.branches.find(
    (branch) => branch.type === 'remote' && branch.branch === payload.gitDefaultBranch
  );
  if (remoteDefault) return remoteDefault;

  if (payload.currentBranch) return { type: 'local', branch: payload.currentBranch };
  return null;
}

export function selectIssueWorkerCandidates(
  issues: Issue[],
  linkedIssueUrls: ReadonlySet<string>,
  limit: number
): Issue[] {
  if (limit <= 0) return [];
  return issues
    .filter((issue) => issue.status?.toLocaleLowerCase() !== 'closed')
    .filter((issue) => Boolean(issue.url) && !linkedIssueUrls.has(issue.url))
    .slice(0, limit);
}
