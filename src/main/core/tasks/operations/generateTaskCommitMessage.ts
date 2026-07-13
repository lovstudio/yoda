import { and, eq } from 'drizzle-orm';
import { formatDeliverySummaryContext } from '@shared/agent-command-context';
import { err, ok, type Result } from '@shared/result';
import { getTaskDeliverySummaries } from '@main/core/conversations/session-summary-context';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { requestUtilityAgentJson } from '../name-generation/task-naming-service';
import { fromStoredBranch } from '../stored-branch';

const MAX_DIFF_STAT_CHARS = 2_000;
const MAX_DIFF_CHARS = 10_000;

/**
 * Generate a squash-commit message for a worktree task via the configured
 * naming agent CLI. The prompt carries the diff against the source branch
 * (committed + uncommitted), so the message describes the full content of the
 * upcoming squash merge.
 */
export async function generateTaskCommitMessage(
  projectId: string,
  taskId: string
): Promise<Result<{ message: string }, string>> {
  const [task] = await db
    .select({ name: tasks.name, taskBranch: tasks.taskBranch, sourceBranch: tasks.sourceBranch })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!task?.taskBranch) return err('Task has no branch.');

  const source = task.sourceBranch ? fromStoredBranch(task.sourceBranch) : undefined;
  if (!source) return err('Task has no source branch.');

  const project = projectManager.getProject(projectId);
  if (!project) return err('Project is not open.');

  const worktreePath = await project.getWorktreeForBranch(task.taskBranch);
  if (!worktreePath) return err('Task worktree was not found.');

  let diffStat = '';
  let diff = '';
  try {
    // Diff against the source branch compares the working tree (uncommitted
    // included) plus all branch commits — exactly what the squash will contain.
    const [statResult, diffResult] = await Promise.all([
      project.ctx.exec('git', ['-C', worktreePath, 'diff', '--stat', source.branch]),
      project.ctx.exec('git', ['-C', worktreePath, 'diff', source.branch]),
    ]);
    diffStat = statResult.stdout.slice(0, MAX_DIFF_STAT_CHARS);
    diff = diffResult.stdout.slice(0, MAX_DIFF_CHARS);
  } catch (e) {
    return err(`Failed to read the task diff: ${String(e)}`);
  }
  if (!diffStat.trim() && !diff.trim()) return err('There are no changes to describe.');

  let deliveryContext = '';
  try {
    deliveryContext = formatDeliverySummaryContext(
      await getTaskDeliverySummaries(projectId, taskId),
      'commit'
    );
  } catch (error) {
    log.warn('generateTaskCommitMessage: failed to load delivery summaries', {
      taskId,
      error: String(error),
    });
  }

  const prompt = [
    'You write a git commit message for squash-merging a task branch.',
    'Return strict JSON only. Do not include markdown, code fences, comments, or explanations.',
    'commitMessage rules:',
    '- First line: conventional-commit style summary ("type(scope): subject"), max 72 characters, imperative mood.',
    '- If the change is substantial, append a blank line and up to 4 short "- " bullet lines.',
    '- Describe what changed and why, not how.',
    'JSON schema: {"commitMessage":"..."}',
    '',
    `Task: ${task.name}`,
    `Branch: ${task.taskBranch} -> ${source.branch}`,
    ...(deliveryContext ? ['', deliveryContext] : []),
    '',
    'Diff stat:',
    diffStat.trim(),
    '',
    'Diff (may be truncated):',
    diff.trim(),
  ].join('\n');

  try {
    const payload = await requestUtilityAgentJson({
      prompt,
      cwd: worktreePath,
      purpose: 'commit-message',
      metadata: { taskId },
    });
    const message = typeof payload.commitMessage === 'string' ? payload.commitMessage.trim() : '';
    if (!message) return err('Model returned no commit message.');
    return ok({ message });
  } catch (e) {
    log.warn('generateTaskCommitMessage: agent CLI failed', { taskId, error: String(e) });
    return err(e instanceof Error ? e.message : String(e));
  }
}
