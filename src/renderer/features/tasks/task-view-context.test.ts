import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProvisionedTask } from './stores/task';
import {
  TaskViewWrapper,
  useProvisionedTask,
  useRequireProvisionedTask,
  useTaskViewContext,
  useTaskViewKind,
} from './task-view-context';

function TaskKindProbe() {
  const { projectId, taskId } = useTaskViewContext();
  const kind = useTaskViewKind();
  return createElement('span', null, `${projectId}:${taskId}:${kind}`);
}

function ProvisionedTaskProbe() {
  return createElement('span', null, useRequireProvisionedTask().taskId);
}

function OptionalTaskProbe() {
  return createElement('span', null, useProvisionedTask()?.taskId ?? 'not-ready');
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

  it('publishes readiness and its task payload as one context snapshot', () => {
    const task = { taskId: 'task-1' } as ProvisionedTask;
    const markup = renderToStaticMarkup(
      createElement(TaskViewWrapper, {
        projectId: 'project-1',
        taskId: 'task-1',
        kind: 'ready',
        provisionedTask: task,
        children: createElement(ProvisionedTaskProbe),
      })
    );

    expect(markup).toContain('task-1');
  });

  it('keeps the optional task payload empty for non-ready snapshots', () => {
    const markup = renderToStaticMarkup(
      createElement(TaskViewWrapper, {
        projectId: 'project-1',
        taskId: 'task-1',
        kind: 'creating',
        children: createElement(OptionalTaskProbe),
      })
    );

    expect(markup).toContain('not-ready');
  });

  it('keeps optional task consumers safe outside a task view', () => {
    const markup = renderToStaticMarkup(createElement(OptionalTaskProbe));

    expect(markup).toContain('not-ready');
  });

  it('keeps the old transient snapshot crash out of the public task hook', () => {
    const source = readFileSync(new URL('./task-view-context.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('useProvisionedTask requires a ready task view snapshot');
    expect(source).toContain('export function useProvisionedTask(): ProvisionedTask | null');
    expect(source).toContain('const ProvisionedTaskContext = createContext');
  });
});
