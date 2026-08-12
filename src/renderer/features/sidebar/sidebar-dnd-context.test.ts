import { describe, expect, it } from 'vitest';
import { isSidebarDndDropAllowed, normalizeSidebarDndId } from './sidebar-dnd-ids';

describe('isSidebarDndDropAllowed', () => {
  it('allows a task to drop onto a task in another project', () => {
    expect(
      isSidebarDndDropAllowed('task::source-project::task-1', 'task::target-project::task-2')
    ).toBe(true);
    expect(
      isSidebarDndDropAllowed(
        'pinned::task::source-project::task-1',
        'pinned::task::target-project::task-2'
      )
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

describe('normalizeSidebarDndId', () => {
  it('unwraps ids emitted by the pinned sidebar rows', () => {
    expect(normalizeSidebarDndId('pinned::task::target-project::task-2')).toBe(
      'task::target-project::task-2'
    );
    expect(normalizeSidebarDndId('task::target-project::task-2')).toBe(
      'task::target-project::task-2'
    );
  });
});
