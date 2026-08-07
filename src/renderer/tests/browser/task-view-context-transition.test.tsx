import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  TaskViewWrapper,
  useRequireProvisionedTask,
  useTaskViewKind,
} from '@renderer/features/tasks/task-view-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(taskId: string): ProvisionedTask {
  return { taskId } as ProvisionedTask;
}

function StatefulReadyProbe() {
  const currentTaskId = useRequireProvisionedTask().taskId;
  const [mountedForTaskId] = useState(currentTaskId);
  return <span>{`${mountedForTaskId}:${currentTaskId}`}</span>;
}

function ReadyGuard() {
  const kind = useTaskViewKind();
  return kind === 'ready' ? <StatefulReadyProbe /> : <span>not-ready</span>;
}

function UnguardedReadyProbe() {
  return <StatefulReadyProbe />;
}

describe('TaskViewWrapper snapshot transitions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('replaces the ready subtree when the routed task identity changes', async () => {
    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a')}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('task-a:task-a');

    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-b"
          kind="ready"
          provisionedTask={task('task-b')}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });

    expect(host.textContent).toBe('task-b:task-b');
  });

  it('removes ready consumers before publishing a non-ready snapshot', async () => {
    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a')}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });

    await act(async () => {
      root.render(
        <TaskViewWrapper projectId="project-1" taskId="task-b" kind="creating">
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });

    expect(host.textContent).toBe('not-ready');
  });

  it('does not render a direct ready consumer after the snapshot becomes non-ready', async () => {
    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a')}
        >
          <UnguardedReadyProbe />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('task-a:task-a');

    await act(async () => {
      root.render(
        <TaskViewWrapper projectId="project-1" taskId="task-b" kind="creating">
          <span>loading</span>
        </TaskViewWrapper>
      );
    });

    expect(host.textContent).toBe('loading');
  });

  it('keeps the last ready payload alive until a same-task ready consumer unmounts', async () => {
    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a:first')}
        >
          <UnguardedReadyProbe />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('task-a:first:task-a:first');

    // A MobX child observer can render once after the owner publishes teardown
    // but before its parent readiness guard commits the child's removal. That
    // late render must keep reading the task from the lifetime boundary.
    await act(async () => {
      root.render(
        <TaskViewWrapper projectId="project-1" taskId="task-a" kind="teardown">
          <UnguardedReadyProbe />
        </TaskViewWrapper>
      );
    });

    expect(host.textContent).toBe('task-a:first:task-a:first');
  });

  it('replaces ready-only consumers across teardown and reprovision of the same task', async () => {
    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a:first')}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('task-a:first:task-a:first');

    await act(async () => {
      root.render(
        <TaskViewWrapper projectId="project-1" taskId="task-a" kind="teardown">
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('not-ready');

    await act(async () => {
      root.render(
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={task('task-a:second')}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });
    expect(host.textContent).toBe('task-a:second:task-a:second');
  });

  it('keeps MobX-driven ready consumers isolated throughout teardown and reprovision', async () => {
    const state = observable<{
      kind: 'ready' | 'teardown';
      provisionedTask: ProvisionedTask | null;
    }>({
      kind: 'ready',
      provisionedTask: task('task-a:first'),
    });
    const Owner = observer(function Owner() {
      if (state.kind !== 'ready' || !state.provisionedTask) {
        return (
          <TaskViewWrapper projectId="project-1" taskId="task-a" kind="teardown">
            <ReadyGuard />
          </TaskViewWrapper>
        );
      }
      return (
        <TaskViewWrapper
          projectId="project-1"
          taskId="task-a"
          kind="ready"
          provisionedTask={state.provisionedTask}
        >
          <ReadyGuard />
        </TaskViewWrapper>
      );
    });

    await act(async () => root.render(<Owner />));
    expect(host.textContent).toBe('task-a:first:task-a:first');

    await act(async () => {
      runInAction(() => {
        state.kind = 'teardown';
        state.provisionedTask = null;
      });
    });
    expect(host.textContent).toBe('not-ready');

    await act(async () => {
      runInAction(() => {
        state.provisionedTask = task('task-a:second');
        state.kind = 'ready';
      });
    });
    expect(host.textContent).toBe('task-a:second:task-a:second');
  });
});
