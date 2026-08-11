import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';

const mocks = vi.hoisted(() => ({
  setIsLeftOpen: vi.fn(),
}));

vi.mock('@renderer/lib/layout/layout-provider', () => ({
  useWorkspaceLayoutContext: () => ({
    leftPanelRef: undefined,
    setIsLeftOpen: mocks.setIsLeftOpen,
    isLeftOpen: true,
  }),
}));

describe('WorkspaceLayout viewport containment', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '960px';
    host.style.height = '480px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it('keeps the main resizable panel from becoming a route scroll owner', () => {
    flushSync(() => {
      root.render(
        <WorkspaceLayout leftSidebar={<div />} mainContent={<div />} rightPane={<div />} />
      );
    });

    const mainPanel = host.querySelector<HTMLElement>('[data-yoda-surface="workspace-main"]');
    const mainPanelContent = mainPanel?.firstElementChild as HTMLElement | null;

    expect(mainPanel).not.toBeNull();
    expect(mainPanelContent).not.toBeNull();
    expect(mainPanelContent?.classList.contains('min-h-0')).toBe(true);
    expect(mainPanelContent?.classList.contains('min-w-0')).toBe(true);
    expect(mainPanelContent?.classList.contains('overflow-hidden')).toBe(true);
  });
});
