import { describe, expect, it } from 'vitest';
import {
  applyTaskViewOptions,
  DEFAULT_TASK_VIEW_OPTIONS,
  rankedClassification,
  type TaskViewItem,
} from '@shared/task-view-options';

function item(overrides: Partial<TaskViewItem>): TaskViewItem {
  return {
    projectId: 'p1',
    projectName: 'Alpha',
    status: 'awaiting-input',
    name: 'task',
    createdAt: '2026-08-01 00:00:00',
    lastInteractedAt: '2026-08-01 00:00:00',
    statusChangedAt: '2026-08-01 00:00:00',
    ...overrides,
  };
}

const rows = [
  item({ name: 'working', status: 'working', projectId: 'p2', projectName: 'Beta' }),
  item({ name: 'awaiting', status: 'awaiting-input' }),
  item({ name: 'idle', status: 'idle', projectId: 'p3', projectName: 'Gamma' }),
];

const names = (result: readonly TaskViewItem[]) => result.map((row) => row.name);

describe('task view classification ranking', () => {
  it('keeps unranked items after the ranked ones and never drops them', () => {
    expect(rankedClassification(['a', 'b', 'c'], ['c'])).toEqual(['c', 'a', 'b']);
    expect(rankedClassification(['a', 'b'], ['b', 'gone'])).toEqual(['b', 'a']);
  });

  it('sorts by the dragged status ranking', () => {
    const result = applyTaskViewOptions(
      rows,
      {
        ...DEFAULT_TASK_VIEW_OPTIONS,
        sortMode: 'status',
        sortDescending: false,
        statusOrder: ['idle', 'working'],
      },
      (row) => row
    );
    // Ranked first in the dragged order, then whatever the ranking never saw.
    expect(names(result)).toEqual(['idle', 'working', 'awaiting']);
  });

  it('groups by project name until a project ranking is dragged', () => {
    const byName = applyTaskViewOptions(
      rows,
      { ...DEFAULT_TASK_VIEW_OPTIONS, sortMode: 'project', sortDescending: false },
      (row) => row
    );
    expect(names(byName)).toEqual(['awaiting', 'working', 'idle']);

    const ranked = applyTaskViewOptions(
      rows,
      {
        ...DEFAULT_TASK_VIEW_OPTIONS,
        sortMode: 'project',
        sortDescending: false,
        projectOrder: ['p3', 'p2'],
      },
      (row) => row
    );
    expect(names(ranked)).toEqual(['idle', 'working', 'awaiting']);
  });
});
