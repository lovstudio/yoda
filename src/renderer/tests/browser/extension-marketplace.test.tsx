import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAAS_GATEWAY_EXTENSION_ID, type YodaMarketplaceExtension } from '@shared/extensions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  extensions: [] as YodaMarketplaceExtension[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/extensions/useExtensionMarketplace', () => ({
  useExtensionMarketplace: () => ({
    extensions: mocks.extensions,
    isLoading: false,
    isRefreshing: false,
    pendingExtensionId: null,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    refresh: vi.fn(),
    install: vi.fn(),
    setEnabled: vi.fn(),
    uninstall: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn(() => () => {}) },
  rpc: {},
}));

describe('Extension Marketplace', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.extensions = [maasGatewayListing()];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders Yoda MaaS Gateway as an installable official extension', async () => {
    const { ExtensionMarketplaceView } = await import(
      '@renderer/features/extensions/ExtensionMarketplaceView'
    );
    await act(async () => root.render(createElement(ExtensionMarketplaceView)));

    expect(host.textContent).toContain('Yoda MaaS Gateway');
    expect(host.textContent).toContain(MAAS_GATEWAY_EXTENSION_ID);
    expect(host.textContent).toContain('LovStudio');
    expect(host.textContent).toContain('extensions.verified');
    expect(host.textContent).toContain('extensions.install');
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
