import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceResourceTrend } from '@renderer/app/workspace-resource-trend';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceResourceTrend', () => {
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

  it('renders CPU and memory as separate time series with accessible summaries', async () => {
    await act(async () => {
      root.render(
        createElement(WorkspaceResourceTrend, {
          history: [
            { sampledAt: '2026-01-01T00:00:00.000Z', cpuPercent: 10, memoryBytes: 100 },
            { sampledAt: '2026-01-01T00:00:05.000Z', cpuPercent: 25, memoryBytes: 120 },
            { sampledAt: '2026-01-01T00:00:10.000Z', cpuPercent: 15, memoryBytes: 110 },
          ],
          title: 'Last minute',
          refreshLabel: 'Every 5 seconds',
          cpuLabel: 'CPU',
          cpuValue: '15%',
          cpuAriaLabel: 'CPU trend, currently 15%',
          memoryLabel: 'Memory',
          memoryValue: '110 MB',
          memoryAriaLabel: 'Memory trend, currently 110 MB',
        })
      );
    });

    expect(host.querySelectorAll('polyline[data-resource-trend]')).toHaveLength(2);
    expect(host.querySelector('[aria-label="CPU trend, currently 15%"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Memory trend, currently 110 MB"]')).not.toBeNull();
    expect(host.textContent).toContain('Last minute');
  });
});
