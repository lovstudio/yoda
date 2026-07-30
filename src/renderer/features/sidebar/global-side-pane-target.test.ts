import { createElement, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GlobalSidePaneTarget } from './global-side-pane-target';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    sidePane: {
      findViewPin: () => undefined,
      toggleView: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ContextMenuContent: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  ContextMenuItem: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children),
  ContextMenuSeparator: () => createElement('hr'),
  ContextMenuTrigger: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}));

vi.mock('@renderer/lib/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  TooltipContent: ({ children }: { children: ReactNode }) =>
    createElement('span', { 'data-tooltip-content': true }, children),
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
}));

describe('GlobalSidePaneTarget', () => {
  it('renders the owning navigation unpin shortcut when provided', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalSidePaneTarget, {
        viewId: 'marketplace',
        params: { section: 'apps', appId: 'app-1' },
        unpinAction: {
          label: 'Unpin from navigation',
          onSelect: vi.fn(),
        },
        children: createElement('button', null, 'Riso'),
      })
    );

    expect(html).toContain('appTabs.openInGlobalSidePane');
    expect(html).toContain('Unpin from navigation');
    expect(html).not.toContain('data-tooltip-content');
  });

  it('keeps the owning item tooltip without showing the global sidebar action as a hint', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalSidePaneTarget, {
        viewId: 'settings',
        tooltipLabel: 'Settings',
        children: createElement('button', null, 'Open settings'),
      })
    );

    expect(html).toContain('<span data-tooltip-content="true">Settings</span>');
    expect(html).not.toContain(
      '<span data-tooltip-content="true">appTabs.openInGlobalSidePane</span>'
    );
  });
});
