import { describe, expect, it } from 'vitest';
import { isSidebarDndDropAllowed } from './sidebar-dnd-ids';

describe('isSidebarDndDropAllowed', () => {
  it('allows a task to drop onto a task in another project', () => {
    expect(
      isSidebarDndDropAllowed('task::source-project::task-1', 'task::target-project::task-2')
    ).toBe(true);
  });

  it('allows a task to drop onto another project root', () => {
    expect(isSidebarDndDropAllowed('task::source-project::task-1', 'proj::target-project')).toBe(
      true
    );
  });

  it('does not treat the source project row as a task drop target', () => {
    expect(isSidebarDndDropAllowed('task::source-project::task-1', 'proj::source-project')).toBe(
      false
    );
  });

  it('keeps project reordering limited to project rows', () => {
    expect(isSidebarDndDropAllowed('proj::source-project', 'proj::target-project')).toBe(true);
    expect(isSidebarDndDropAllowed('proj::source-project', 'task::target-project::task-2')).toBe(
      false
    );
  });
});
