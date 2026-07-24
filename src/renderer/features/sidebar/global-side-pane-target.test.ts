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
  TooltipContent: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
}));

describe('GlobalSidePaneTarget', () => {
  it('renders the owning navigation unpin shortcut when provided', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalSidePaneTarget, {
        viewId: 'library',
        params: { section: 'apps', appId: 'app-1' },
        altHeld: false,
        unpinAction: {
          label: 'Unpin from navigation',
          onSelect: vi.fn(),
        },
        children: createElement('button', null, 'Riso'),
      })
    );

    expect(html).toContain('appTabs.openInGlobalSidePane');
    expect(html).toContain('Unpin from navigation');
  });
});
