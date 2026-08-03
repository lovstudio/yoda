import type { Task } from './tasks';

/**
 * The mutually exclusive product-facing category for a task.
 *
 * A task can retain its long-term marker after it enters the acceptance queue,
 * but the queue takes display priority so every task appears in one category.
 */
export type TaskKind = 'standard' | 'long-term' | 'pending-acceptance' | 'archived';

export function taskKind(task: Pick<Task, 'archivedAt' | 'isLongTerm' | 'needsReview'>): TaskKind {
  if (task.archivedAt) return 'archived';
  if (task.needsReview) return 'pending-acceptance';
  if (task.isLongTerm) return 'long-term';
  return 'standard';
}
