import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SidebarMenuRow } from '@renderer/features/sidebar/sidebar-primitives';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarMenuRow', () => {
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

  it('applies a stronger hover surface across the full row', async () => {
    await act(async () => {
      root.render(createElement(SidebarMenuRow, null, 'Project row'));
    });

    const row = host.querySelector<HTMLElement>('[data-yoda-surface="sidebar-menu-row"]');
    expect(row).not.toBeNull();
    expect(row?.classList).toContain('w-full');
    expect(row?.classList).toContain('hover:bg-background-tertiary-2');
    expect(row?.classList).toContain('data-[active=true]:hover:bg-background-tertiary-3');
  });
});
