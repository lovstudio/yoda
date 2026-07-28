import { describe, expect, it } from 'vitest';
import { findSidebarSelectionRow } from '@renderer/features/sidebar/sidebar-selection-sync';

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
});

function makeTaskRow(projectId: string, taskId: string): HTMLElement {
  const row = document.createElement('div');
  row.dataset.sidebarEntity = 'task';
  row.dataset.sidebarProjectId = projectId;
  row.dataset.sidebarTaskId = taskId;
  return row;
}
