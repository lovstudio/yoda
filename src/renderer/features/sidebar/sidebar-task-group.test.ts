import { describe, expect, it } from 'vitest';
import {
  getSidebarTaskGroupDisclosure,
  SIDEBAR_TASK_GROUP_REVEAL_INCREMENT,
  visibleSidebarTaskGroupCountForItem,
} from './sidebar-task-group';

describe('sidebar task group disclosure', () => {
  const items = Array.from({ length: 28 }, (_, index) => index + 1);

  it('reveals ten additional rows at a time after the initial threshold', () => {
    const first = getSidebarTaskGroupDisclosure(items, 5);
    const second = getSidebarTaskGroupDisclosure(items, 5 + SIDEBAR_TASK_GROUP_REVEAL_INCREMENT);
    const third = getSidebarTaskGroupDisclosure(items, 5 + SIDEBAR_TASK_GROUP_REVEAL_INCREMENT * 2);
    const final = getSidebarTaskGroupDisclosure(items, 35);

    expect(first).toMatchObject({ visibleItems: items.slice(0, 5), hiddenCount: 23 });
    expect(second).toMatchObject({ visibleItems: items.slice(0, 15), hiddenCount: 13 });
    expect(third).toMatchObject({ visibleItems: items.slice(0, 25), hiddenCount: 3 });
    expect(final).toMatchObject({ visibleItems: items, hiddenCount: 0 });
  });

  it('expands only far enough to reveal a selected hidden item', () => {
    expect(visibleSidebarTaskGroupCountForItem(items, (item) => item === 18, 15)).toBe(18);
    expect(visibleSidebarTaskGroupCountForItem(items, (item) => item === 12, 15)).toBeNull();
  });

  it('keeps a server-backed remainder even before its first page is hydrated', () => {
    expect(getSidebarTaskGroupDisclosure([], 0, 1_203)).toEqual({
      visibleItems: [],
      hiddenCount: 1_203,
    });
  });
});
