import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  setParams: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useIsPinHosted: () => false,
  useParams: () => ({ setParams: mocks.setParams }),
}));

vi.mock('@renderer/lib/components/titlebar/Titlebar', () => ({
  Titlebar: () => createElement('div', null, 'titlebar'),
}));

vi.mock('@renderer/features/extensions/ExtensionMarketplaceView', () => ({
  ExtensionMarketplaceView: () =>
    createElement('div', { 'data-testid': 'extension-marketplace' }, 'extensions'),
}));

vi.mock('@renderer/features/ai-lab/components/AiLabView', () => ({
  AiLabView: ({ activeAppId }: { activeAppId?: string | null }) =>
    createElement('div', { 'data-testid': 'apps-shelf', 'data-app-id': activeAppId }, 'apps'),
}));

describe('Marketplace sections', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps Extensions as the default section and exposes Apps beside it', async () => {
    const { MarketplaceMainPanel, MarketplaceViewWrapper } = await import(
      '@renderer/features/extensions/marketplace-view'
    );

    await act(async () =>
      root.render(
        createElement(MarketplaceViewWrapper, {
          children: createElement(MarketplaceMainPanel),
        })
      )
    );

    expect(host.querySelector('[data-testid="extension-marketplace"]')).not.toBeNull();
    expect(host.textContent).toContain('marketplace.sections.extensions');
    expect(host.textContent).toContain('marketplace.sections.apps');

    const appsButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'marketplace.sections.apps'
    );
    await act(async () => appsButton?.click());

    expect(mocks.setParams).toHaveBeenCalledWith({ section: 'apps' });
  });

  it('opens a selected app inside the Marketplace Apps section', async () => {
    const { MarketplaceMainPanel, MarketplaceViewWrapper } = await import(
      '@renderer/features/extensions/marketplace-view'
    );

    await act(async () =>
      root.render(
        createElement(MarketplaceViewWrapper, {
          section: 'apps',
          appId: 'app-1',
          children: createElement(MarketplaceMainPanel),
        })
      )
    );

    expect(host.querySelector('[data-testid="apps-shelf"]')?.getAttribute('data-app-id')).toBe(
      'app-1'
    );
    expect(host.querySelector('[data-testid="extension-marketplace"]')).toBeNull();
  });
});
