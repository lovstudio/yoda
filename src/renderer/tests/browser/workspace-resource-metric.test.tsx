import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceResourceMetric } from '@renderer/app/workspace-resource-metric';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceResourceMetric', () => {
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

  it('keeps passive resource values as status-only content', async () => {
    await act(async () => {
      root.render(createElement(WorkspaceResourceMetric, { label: 'CPU', value: '8%' }));
    });

    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toContain('CPU');
    expect(host.textContent).toContain('8%');
  });

  it('renders an actionable metric as a keyboard-focusable button', async () => {
    const onClick = vi.fn();
    await act(async () => {
      root.render(
        createElement(WorkspaceResourceMetric, {
          label: 'Running agents',
          value: '2',
          ariaLabel: 'Show 2 running agents',
          controls: 'agent-list',
          expanded: false,
          onClick,
        })
      );
    });

    const button = host.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-controls')).toBe('agent-list');
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => button?.click());

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('announces resource detail actions as dialogs', async () => {
    await act(async () => {
      root.render(
        createElement(WorkspaceResourceMetric, {
          label: 'CPU',
          value: '18%',
          ariaLabel: 'Open CPU details',
          opensDialog: true,
          onClick: vi.fn(),
        })
      );
    });

    const button = host.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.hasAttribute('aria-expanded')).toBe(false);
  });
});
