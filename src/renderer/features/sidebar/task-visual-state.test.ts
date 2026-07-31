import { describe, expect, it } from 'vitest';
import { shouldDeemphasizeLongTermTask } from './task-visual-state';

describe('shouldDeemphasizeLongTermTask', () => {
  it.each([
    { isLongTerm: true, needsReview: false, isIdle: true, expected: true },
    { isLongTerm: true, needsReview: true, isIdle: true, expected: false },
    { isLongTerm: true, needsReview: false, isIdle: false, expected: false },
    { isLongTerm: false, needsReview: false, isIdle: true, expected: false },
  ] as const)(
    'returns $expected for idle=$isIdle, longTerm=$isLongTerm, needsReview=$needsReview',
    ({ expected, isIdle, ...task }) => {
      expect(shouldDeemphasizeLongTermTask(task, isIdle)).toBe(expected);
    }
  );
});
