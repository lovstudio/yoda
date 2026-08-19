import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { MaasConnection, MaasGlobalBindingStatus } from '@shared/maas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  binding: {
    platformId: 'custom:first',
    enabled: true,
    effective: true,
    runtimeIds: ['codex'],
  } as MaasGlobalBindingStatus,
  connections: [] as MaasConnection[],
  setBinding: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@renderer/features/maas/useMaas', () => ({
  useMaasConnections: () => ({ data: mocks.connections, isLoading: false }),
  useMaasGlobalBinding: () => ({ data: mocks.binding, isLoading: false }),
  useSetMaasGlobalBinding: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.setBinding,
  }),
}));

describe('MaasGlobalSelector', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.binding = {
      platformId: 'custom:first',
      enabled: true,
      effective: true,
      runtimeIds: ['codex'],
    };
    mocks.connections = [
      connection({ platformId: 'custom:first', displayName: 'First Custom' }),
      connection({ platformId: 'custom:second', displayName: 'Second Custom' }),
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('toggles the global binding straight from a row', async () => {
    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () => root.render(createElement(MaasGlobalSelector)));

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-slot="dropdown-menu-trigger"][aria-label="maas.global.title"]'
    );
    expect(trigger?.textContent).toContain('First Custom');
    expect(trigger?.textContent).toContain('maas.global.effective');
    // Configuring a Profile lives in Settings — this control never navigates.
    expect(host.querySelector('[aria-label="maas.global.manage"]')).toBeNull();

    await userEvent.click(trigger!);
    const secondProfile = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')).find(
        (item) => item.textContent?.includes('Second Custom')
      );
    await userEvent.click(secondProfile()!.querySelector<HTMLElement>('span')!);
    expect(mocks.setBinding).toHaveBeenCalledWith(
      { platformId: 'custom:second', enabled: true },
      expect.any(Object)
    );
  });

  it('can keep the selected Profile compact when status is shown by the parent surface', async () => {
    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () =>
      root.render(createElement(MaasGlobalSelector, { showSelectedStatus: false }))
    );

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-slot="dropdown-menu-trigger"][aria-label="maas.global.title"]'
    );
    expect(trigger?.textContent).toContain('First Custom');
    expect(trigger?.textContent).not.toContain('maas.global.effective');
    expect(host.querySelector('[aria-label="maas.global.manage"]')).toBeNull();

    await userEvent.click(trigger!);
    const selectedOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('First Custom'));
    expect(selectedOption?.textContent).toContain('maas.global.effective');
    expect(selectedOption?.querySelector('[data-slot="switch"]')?.getAttribute('aria-label')).toBe(
      'maas.global.disableAria'
    );
  });

  it('allows enabling a configured Profile even when its connection test failed', async () => {
    mocks.binding = { platformId: null, enabled: false, effective: false, runtimeIds: [] };
    mocks.connections = [
      connection({
        platformId: 'custom:first',
        displayName: 'First Custom',
        lastTest: {
          ok: false,
          error: 'HTTP 401',
          checkedAt: '2026-08-14T00:00:00.000Z',
          samples: [{ durationMs: 12, ok: false, error: 'HTTP 401' }],
          averageLatencyMs: null,
        },
      }),
    ];
    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () => root.render(createElement(MaasGlobalSelector)));

    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]');
    await userEvent.click(trigger!);
    const profile = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('First Custom'));

    expect(profile?.hasAttribute('data-disabled')).toBe(false);
    const enableSwitch = profile?.querySelector<HTMLElement>('[data-slot="switch"]');
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(false);

    await userEvent.click(profile!.querySelector<HTMLElement>('span')!);
    expect(mocks.setBinding).toHaveBeenCalledWith(
      { platformId: 'custom:first', enabled: true },
      expect.any(Object)
    );
  });
});

function connection(overrides: Partial<MaasConnection> = {}): MaasConnection {
  return {
    platformId: 'custom:first',
    displayName: 'First Custom',
    endpoint: 'https://example.com/v1',
    keyFingerprint: 'ke...ey',
    inferenceKeyFingerprint: 'ke...ey',
    connectedAt: '2026-08-14T00:00:00.000Z',
    lastCheckedAt: '2026-08-14T00:00:00.000Z',
    lastTest: {
      ok: true,
      error: null,
      checkedAt: '2026-08-14T00:00:00.000Z',
      samples: [{ durationMs: 12, ok: true, error: null }],
      averageLatencyMs: 12,
    },
    configured: true,
    connected: true,
    error: null,
    ...overrides,
  };
}
