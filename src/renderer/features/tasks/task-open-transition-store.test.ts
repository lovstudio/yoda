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

describe('taskOpenTransitionStore session opening owners', () => {
  it('keeps the task opening while any mounted conversation surface still needs it', () => {
    const firstOwner = Symbol('first conversation panel');
    const secondOwner = Symbol('second conversation panel');

    taskOpenTransitionStore.reportSessionOpening(PROJECT_ID, TASK_ID, firstOwner, true);
    taskOpenTransitionStore.reportSessionOpening(PROJECT_ID, TASK_ID, secondOwner, true);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(true);

    taskOpenTransitionStore.clearSessionOpening(PROJECT_ID, TASK_ID, firstOwner);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(true);

    taskOpenTransitionStore.reportSessionOpening(PROJECT_ID, TASK_ID, secondOwner, false);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(false);
  });

  it('does not let a stale owner clear the current opening intent', () => {
    const currentOwner = Symbol('current conversation panel');
    const staleOwner = Symbol('stale conversation panel');

    taskOpenTransitionStore.reportSessionOpening(PROJECT_ID, TASK_ID, currentOwner, true);
    taskOpenTransitionStore.clearSessionOpening(PROJECT_ID, TASK_ID, staleOwner);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(true);

    taskOpenTransitionStore.clearSessionOpening(PROJECT_ID, TASK_ID, currentOwner);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(false);
  });

  it('tracks error-detail owners independently from ordinary opening owners', () => {
    const owner = Symbol('conversation error detail');

    taskOpenTransitionStore.reportSessionOpening(PROJECT_ID, TASK_ID, owner, true);
    taskOpenTransitionStore.reportSessionError(PROJECT_ID, TASK_ID, owner, true);
    expect(taskOpenTransitionStore.isSessionOpening(PROJECT_ID, TASK_ID)).toBe(true);
    expect(taskOpenTransitionStore.hasSessionError(PROJECT_ID, TASK_ID)).toBe(true);

    taskOpenTransitionStore.clearSessionError(PROJECT_ID, TASK_ID, owner);
    taskOpenTransitionStore.clearSessionOpening(PROJECT_ID, TASK_ID, owner);
    expect(taskOpenTransitionStore.hasSessionError(PROJECT_ID, TASK_ID)).toBe(false);
  });
});
