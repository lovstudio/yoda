import { describe, expect, it, vi } from 'vitest';
import type { CommandPalettePage, SearchItem } from '@shared/search';
import { uniqueScopedSearchItems } from './use-scoped-search';

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

function item(id: string, title: string): SearchItem {
  return {
    kind: 'task',
    id,
    projectId: 'project-1',
    taskId: null,
    title,
    subtitle: '',
    score: 0,
  };
}

describe('uniqueScopedSearchItems', () => {
  it('keeps one stable item when recency changes overlap offset pages', () => {
    const pages: CommandPalettePage[] = [
      { items: [item('task-1', 'Fresh title'), item('task-2', 'Second')], nextOffset: 2 },
      { items: [item('task-2', 'Stale duplicate'), item('task-3', 'Third')], nextOffset: null },
    ];

    expect(uniqueScopedSearchItems(pages)).toEqual([
      item('task-1', 'Fresh title'),
      item('task-2', 'Second'),
      item('task-3', 'Third'),
    ]);
  });
});
