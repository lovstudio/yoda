import { observable, runInAction } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMobxValue } from '@renderer/lib/hooks/use-mobx-value';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useMobxValue', () => {
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

  it('commits a combined MobX selector update as one route-shaped snapshot', async () => {
    const route = observable({ view: 'project', taskId: 'archived-task' });

    function RouteProbe() {
      const snapshot = useMobxValue(() => ({ view: route.view, taskId: route.taskId }));
      return <span>{`${snapshot.view}:${snapshot.taskId}`}</span>;
    }

    await act(async () => root.render(<RouteProbe />));
    expect(host.textContent).toBe('project:archived-task');

    await act(async () => {
      runInAction(() => {
        route.view = 'task';
        route.taskId = 'restored-task';
      });
    });

    expect(host.textContent).toBe('task:restored-task');
  });
});
