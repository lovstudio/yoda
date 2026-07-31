import { describe, expect, it, vi } from 'vitest';
import {
  findSidebarSelectionRow,
  resolveSidebarSelectionTarget,
  revealSidebarSelectionRow,
} from '@renderer/features/sidebar/sidebar-selection-sync';
import '../../index.css';

describe('sidebar selection sync', () => {
  it('prioritizes an explicit locator request over the project from the current route', () => {
    expect(
      resolveSidebarSelectionTarget(
        {
          key: 'task:route-project:route-task',
          projectId: 'route-project',
          taskId: 'route-task',
        },
        {
          requestId: 7,
          projectId: 'selected-project',
        }
      )
    ).toEqual({
      key: 'reveal:7',
      projectId: 'selected-project',
      requestId: 7,
      shouldFocus: true,
    });
  });

  it('falls back to the current route when no locator request is pending', () => {
    expect(
      resolveSidebarSelectionTarget(
        {
          key: 'project:route-project:',
          projectId: 'route-project',
        },
        null
      )
    ).toEqual({
      key: 'project:route-project:',
      projectId: 'route-project',
      shouldFocus: false,
    });
  });

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
    vi.useFakeTimers();
    const root = document.createElement('div');
    const project = document.createElement('button');
    project.dataset.sidebarEntity = 'project';
    project.dataset.sidebarProjectId = 'project-2';
    project.scrollIntoView = vi.fn();
    const focus = vi.spyOn(project, 'focus');
    root.append(project);
    document.body.append(root);

    expect(revealSidebarSelectionRow(root, 'project-2', undefined, true)).toBe(project);
    expect(project.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(project.dataset.sidebarLocateHighlight).toBe('true');
    expect(getComputedStyle(project).animationName).toBe('sidebar-locate-highlight');

    vi.advanceTimersByTime(1600);
    expect(project.dataset.sidebarLocateHighlight).toBeUndefined();
    root.remove();
    vi.useRealTimers();
  });
});

function makeTaskRow(projectId: string, taskId: string): HTMLElement {
  const row = document.createElement('div');
  row.dataset.sidebarEntity = 'task';
  row.dataset.sidebarProjectId = projectId;
  row.dataset.sidebarTaskId = taskId;
  return row;
}
