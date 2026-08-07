import type { Issue } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';

export async function hydrateIssueContext(issue: Issue): Promise<Issue> {
  try {
    return await rpc.issues.hydrateIssue(issue);
  } catch {
    return issue;
  }
}
