import { describe, expect, it, vi } from 'vitest';
import {
  findSidebarSelectionRow,
  revealSidebarSelectionRow,
} from '@renderer/features/sidebar/sidebar-selection-sync';

describe('sidebar selection sync', () => {
  it('finds the selected project row across the whole sidebar', () => {
    const root = document.createElement('div');
    const project = document.createElement('div');
    project.dataset.sidebarEntity = 'project';
    project.dataset.sidebarProjectId = 'project-2';
    root.append(project);

    expect(findSidebarSelectionRow(root, 'project-2')).toBe(project);
  });

  it('distinguishes sessions with the same id under different projects', () => {
    const root = document.createElement('div');
    const other = makeTaskRow('project-1', 'task-1');
    const selected = makeTaskRow('project-2', 'task-1');
    root.append(other, selected);

    expect(findSidebarSelectionRow(root, 'project-2', 'task-1')).toBe(selected);
  });

  it('scrolls and focuses a project row for an explicit locator request', () => {
    const root = document.createElement('div');
    const project = document.createElement('button');
    project.dataset.sidebarEntity = 'project';
    project.dataset.sidebarProjectId = 'project-2';
    project.scrollIntoView = vi.fn();
    const focus = vi.spyOn(project, 'focus');
    root.append(project);

    expect(revealSidebarSelectionRow(root, 'project-2', undefined, true)).toBe(project);
    expect(project.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

function makeTaskRow(projectId: string, taskId: string): HTMLElement {
  const row = document.createElement('div');
  row.dataset.sidebarEntity = 'task';
  row.dataset.sidebarProjectId = projectId;
  row.dataset.sidebarTaskId = taskId;
  return row;
}
