import type { Task } from '@shared/tasks';

type LongTermTaskVisualState = Pick<Task, 'isLongTerm' | 'needsReview' | 'status'>;

export function shouldDeemphasizeLongTermTask(task: LongTermTaskVisualState): boolean {
  const isFinished = task.status === 'done' || task.status === 'cancelled';
  return task.isLongTerm && isFinished && !task.needsReview;
}
