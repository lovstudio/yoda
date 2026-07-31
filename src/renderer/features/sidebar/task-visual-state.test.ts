import { describe, expect, it } from 'vitest';
import { shouldDeemphasizeLongTermTask } from './task-visual-state';

describe('shouldDeemphasizeLongTermTask', () => {
  it.each([
    { isLongTerm: true, needsReview: false, status: 'done', expected: true },
    { isLongTerm: true, needsReview: false, status: 'cancelled', expected: true },
    { isLongTerm: true, needsReview: true, status: 'done', expected: false },
    { isLongTerm: true, needsReview: false, status: 'in_progress', expected: false },
    { isLongTerm: false, needsReview: false, status: 'done', expected: false },
  ] as const)(
    'returns $expected for status=$status, longTerm=$isLongTerm, needsReview=$needsReview',
    ({ expected, ...task }) => {
      expect(shouldDeemphasizeLongTermTask(task)).toBe(expected);
    }
  );
});
