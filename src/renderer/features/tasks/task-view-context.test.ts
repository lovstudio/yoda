import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskViewWrapper, useTaskViewContext, useTaskViewKind } from './task-view-context';

vi.mock('./stores/task-selectors', () => ({
  asProvisioned: vi.fn(),
  getTaskStore: vi.fn(),
}));

function TaskKindProbe() {
  const { projectId, taskId } = useTaskViewContext();
  const kind = useTaskViewKind();
  return createElement('span', null, `${projectId}:${taskId}:${kind}`);
}

describe('task view state snapshot', () => {
  it('publishes the owner-captured kind through the task view context', () => {
    const markup = renderToStaticMarkup(
      createElement(TaskViewWrapper, {
        projectId: 'project-1',
        taskId: 'task-1',
        kind: 'creating',
        children: createElement(TaskKindProbe),
      })
    );

    expect(markup).toContain('project-1:task-1:creating');
  });

  it('keeps ready-state consumers on the provider owner snapshot', () => {
    const mainPanelSource = readFileSync(new URL('./main-panel.tsx', import.meta.url), 'utf8');
    const titlebarSource = readFileSync(new URL('./task-titlebar.tsx', import.meta.url), 'utf8');
    const taskWindowSource = readFileSync(new URL('./task-window.tsx', import.meta.url), 'utf8');

    expect(mainPanelSource).toContain('const kind = useTaskViewKind();');
    expect(titlebarSource).toContain('const kind = useTaskViewKind();');
    expect(taskWindowSource).toContain('const kind = useTaskViewKind();');
    expect(mainPanelSource).not.toContain('const kind = taskViewKind(');
    expect(titlebarSource).not.toContain('const kind = taskViewKind(');
    expect(taskWindowSource).not.toContain('const kind = taskViewKind(');
  });
});
