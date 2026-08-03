import { describe, expect, it } from 'vitest';
import { taskKind } from './task-kind';

describe('taskKind', () => {
  it.each([
    [{ isLongTerm: false, needsReview: false }, 'standard'],
    [{ isLongTerm: true, needsReview: false }, 'long-term'],
    [{ isLongTerm: false, needsReview: true }, 'pending-acceptance'],
    [{ isLongTerm: true, needsReview: true }, 'pending-acceptance'],
    [{ archivedAt: '2026-08-03T00:00:00.000Z', isLongTerm: true, needsReview: true }, 'archived'],
  ] as const)('classifies %o as %s', (task, expected) => {
    expect(taskKind(task)).toBe(expected);
  });
});
