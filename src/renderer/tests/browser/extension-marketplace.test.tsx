import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAAS_GATEWAY_EXTENSION_ID, type YodaMarketplaceExtension } from '@shared/extensions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  extensions: [] as YodaMarketplaceExtension[],
  install: vi.fn(),
  listMarketplace: vi.fn(),
  setEnabled: vi.fn(),
  uninstall: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn(() => () => {}) },
  rpc: {
    extensions: {
      install: mocks.install,
      listMarketplace: mocks.listMarketplace,
      setEnabled: mocks.setEnabled,
      uninstall: mocks.uninstall,
    },
  },
}));

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('Extension Marketplace', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extensions = [maasGatewayListing()];
    mocks.listMarketplace.mockImplementation(async () => mocks.extensions);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
  });

  it('renders Yoda MaaS Gateway as an installable official extension', async () => {
    const { ExtensionMarketplaceView } = await import(
      '@renderer/features/extensions/ExtensionMarketplaceView'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ExtensionMarketplaceView)
        )
      )
    );
    await settle();

    expect(host.textContent).toContain('Yoda MaaS Gateway');
    expect(host.textContent).toContain(MAAS_GATEWAY_EXTENSION_ID);
    expect(host.textContent).toContain('LovStudio');
    expect(host.textContent).toContain('extensions.verified');
    expect(host.textContent).toContain('extensions.install');
  });

  it('switches an installed extension off and on without flicker or a stale pending lock', async () => {
    const disableResult = deferred<{
      success: true;
      extension: YodaMarketplaceExtension;
    }>();
    const enableResult = deferred<{
      success: true;
      extension: YodaMarketplaceExtension;
    }>();
    mocks.extensions = [installedGatewayListing(true)];
    mocks.setEnabled
      .mockReturnValueOnce(disableResult.promise)
      .mockReturnValueOnce(enableResult.promise);
    const { ExtensionMarketplaceView } = await import(
      '@renderer/features/extensions/ExtensionMarketplaceView'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ExtensionMarketplaceView)
        )
      )
    );
    await settle();

    const getSwitch = () =>
      host.querySelector<HTMLElement>(`[data-slot="switch"][aria-label="extensions.toggleAria"]`);
    expect(getSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(getSwitch()?.hasAttribute('data-disabled')).toBe(false);

    await act(async () => getSwitch()?.click());
    await settle();
    expect(mocks.setEnabled).toHaveBeenNthCalledWith(1, {
      extensionId: MAAS_GATEWAY_EXTENSION_ID,
      enabled: false,
    });
    expect(getSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(getSwitch()?.hasAttribute('data-disabled')).toBe(true);

    disableResult.resolve({
      success: true,
      extension: installedGatewayListing(false),
    });
    await settle();
    expect(getSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(getSwitch()?.hasAttribute('data-disabled')).toBe(false);

    await act(async () => getSwitch()?.click());
    await settle();
    expect(mocks.setEnabled).toHaveBeenNthCalledWith(2, {
      extensionId: MAAS_GATEWAY_EXTENSION_ID,
      enabled: true,
    });
    expect(getSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(getSwitch()?.hasAttribute('data-disabled')).toBe(true);

    enableResult.resolve({
      success: true,
      extension: installedGatewayListing(true),
    });
    await settle();
    expect(getSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(getSwitch()?.hasAttribute('data-disabled')).toBe(false);
  });
});

function maasGatewayListing(): YodaMarketplaceExtension {
  return {
    manifest: {
      schemaVersion: 1,
      id: MAAS_GATEWAY_EXTENSION_ID,
      name: 'Yoda MaaS Gateway',
      version: '1.0.0',
      description: 'Route Codex through a local MaaS gateway.',
      kind: 'background-service',
      publisher: {
        id: 'lovstudio',
        name: 'LovStudio',
        verified: true,
      },
      capabilities: [
        'network.loopback',
        'network.outbound',
        'secrets.provider',
        'client.codex.configure',
        'autostart.yoda',
      ],
      platforms: ['darwin', 'win32', 'linux'],
      service: {
        entry: 'maas-gateway',
        autoStart: true,
        healthPath: '/health',
      },
    },
    installation: null,
    runtime: null,
    supported: true,
  };
}

function installedGatewayListing(enabled: boolean): YodaMarketplaceExtension {
  return {
    ...maasGatewayListing(),
    installation: {
      extensionId: MAAS_GATEWAY_EXTENSION_ID,
      version: '1.0.0',
      installedAt: '2026-07-28T00:00:00.000Z',
      enabled,
      grantedCapabilities: maasGatewayListing().manifest.capabilities,
    },
    runtime: {
      state: enabled ? 'running' : 'stopped',
      pid: enabled ? 123 : null,
      port: enabled ? 15721 : null,
      endpoint: enabled ? 'http://127.0.0.1:15721/v1' : null,
      configuredProviderId: null,
      error: null,
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
