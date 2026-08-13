import { afterEach, describe, expect, it } from 'vitest';
import { taskOpenTransitionStore } from './task-open-transition-store';

const PROJECT_ID = 'transition-project';
const TASK_ID = 'transition-task';

afterEach(() => {
  taskOpenTransitionStore.dismissFailure(PROJECT_ID, TASK_ID);
});

describe('taskOpenTransitionStore failures', () => {
  it('is not failed before, after completion, or after dismissal', () => {
    expect(taskOpenTransitionStore.hasFailed(PROJECT_ID, TASK_ID)).toBe(false);

    const completed = taskOpenTransitionStore.begin(PROJECT_ID, TASK_ID);
    taskOpenTransitionStore.complete(PROJECT_ID, TASK_ID, completed);
    expect(taskOpenTransitionStore.hasFailed(PROJECT_ID, TASK_ID)).toBe(false);

    const failed = taskOpenTransitionStore.begin(PROJECT_ID, TASK_ID);
    taskOpenTransitionStore.fail(
      PROJECT_ID,
      TASK_ID,
      failed,
      { kind: 'conversation', conversationId: 'conversation-1' },
      new Error('frame failed')
    );
    expect(taskOpenTransitionStore.hasFailed(PROJECT_ID, TASK_ID)).toBe(true);
    expect(taskOpenTransitionStore.failureDebugInfo(PROJECT_ID, TASK_ID)).toContain('frame failed');

    taskOpenTransitionStore.dismissFailure(PROJECT_ID, TASK_ID);
    expect(taskOpenTransitionStore.hasFailed(PROJECT_ID, TASK_ID)).toBe(false);
  });
});
