import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => (key === 'common.close' ? 'Close' : key),
  }),
}));

vi.mock('@renderer/app/tab-drag', () => ({
  tabDragSource: () => ({}),
  tabDropIndex: () => 0,
  useTabDropZone: () => ({
    dropRef: () => {},
    isOver: false,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
  events: { on: vi.fn(() => () => undefined), emit: vi.fn() },
}));

vi.mock('@renderer/lib/ui/tooltip', async () => {
  const { createElement } = await import('react');
  return {
    Tooltip: ({ children }: { children: ReactNode }) => children,
    TooltipContent: ({ children }: { children: ReactNode }) =>
      createElement('span', null, children),
    TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  };
});

describe('TerminalDrawerSidebar hosted Quick Action', () => {
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

  it('shows, selects, and closes the Quick Action as a terminal row', async () => {
    const { TerminalDrawerSidebar } = await import(
      '@renderer/features/tasks/terminals/terminal-drawer-sidebar'
    );
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const terminalTabView = {
      tabs: [],
      tabOrder: [],
      reorderTabs: vi.fn(),
    } as unknown as TerminalTabViewStore;

    await act(async () => {
      root.render(
        <TerminalDrawerSidebar
          terminalTabView={terminalTabView}
          activeTerminalId={undefined}
          onSelectTerminal={vi.fn()}
          onRemoveTerminal={vi.fn()}
          onRenameTerminal={vi.fn()}
          onCreateTerminal={vi.fn()}
          hostedQuickAction={{
            label: 'Quick action: Start locally',
            isActive: true,
            onSelect,
            onClose,
          }}
        />
      );
    });

    const label = Array.from(host.querySelectorAll('span')).find(
      (element) => element.textContent === 'Quick action: Start locally'
    );
    const row = label?.closest<HTMLDivElement>('.group');
    expect(row).not.toBeNull();

    await act(async () => row?.click());
    expect(onSelect).toHaveBeenCalledOnce();

    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    await act(async () => close?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
