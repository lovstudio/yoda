import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRendererActivity } from '@renderer/features/tasks/task-renderer-activity';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskRendererActivity', () => {
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

  it('builds only the active renderer on first paint and retains it after visiting', async () => {
    const rendered = vi.fn();

    function Probe() {
      rendered();
      const [value] = useState('retained');
      useEffect(() => undefined, []);
      return <span data-probe>{value}</span>;
    }

    await act(async () => {
      root.render(
        <TaskRendererActivity active={false}>
          <Probe />
        </TaskRendererActivity>
      );
    });
    expect(rendered).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <TaskRendererActivity active>
          <Probe />
        </TaskRendererActivity>
      );
    });
    expect(host.querySelector('[data-probe]')?.textContent).toBe('retained');
    const rendersAfterVisit = rendered.mock.calls.length;

    await act(async () => {
      root.render(
        <TaskRendererActivity active={false}>
          <Probe />
        </TaskRendererActivity>
      );
    });
    expect(rendered.mock.calls.length).toBeGreaterThanOrEqual(rendersAfterVisit);

    await act(async () => {
      root.render(
        <TaskRendererActivity active>
          <Probe />
        </TaskRendererActivity>
      );
    });
    expect(host.querySelector('[data-probe]')?.textContent).toBe('retained');
  });
});
