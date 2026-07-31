import type { Task } from '@shared/tasks';

type LongTermTaskVisualState = Pick<Task, 'isLongTerm' | 'needsReview'>;

export function shouldDeemphasizeLongTermTask(
  task: LongTermTaskVisualState,
  isIdle: boolean
): boolean {
  return task.isLongTerm && isIdle && !task.needsReview;
}
