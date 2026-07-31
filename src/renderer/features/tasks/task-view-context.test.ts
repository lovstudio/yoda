import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProvisionedTask } from './stores/task';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
  useProvisionedTask,
  useTaskViewContext,
  useTaskViewKind,
} from './task-view-context';

function TaskKindProbe() {
  const { projectId, taskId } = useTaskViewContext();
  const kind = useTaskViewKind();
  return createElement('span', null, `${projectId}:${taskId}:${kind}`);
}

function ProvisionedTaskProbe() {
  return createElement('span', null, useProvisionedTask().taskId);
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
    expect(mainPanelSource).toContain("if (kind !== 'ready') {");
    expect(titlebarSource).toContain('const kind = useTaskViewKind();');
    expect(taskWindowSource).toContain('const kind = useTaskViewKind();');
    expect(mainPanelSource).not.toContain('const kind = taskViewKind(');
    expect(titlebarSource).not.toContain('const kind = taskViewKind(');
    expect(taskWindowSource).not.toContain('const kind = taskViewKind(');
  });

  it('provides the task instance captured by the ready-state owner', () => {
    const task = { taskId: 'task-1' } as ProvisionedTask;
    const markup = renderToStaticMarkup(
      createElement(ProvisionedTaskProvider, {
        task,
        children: createElement(ProvisionedTaskProbe),
      })
    );

    expect(markup).toContain('task-1');
  });
});
