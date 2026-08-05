import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliProxyApiManagedStatus } from '@shared/cliproxyapi-managed';
import type { LiteLlmManagedStatus } from '@shared/litellm-managed';
import type { MaasConnection, MaasGlobalBindingStatus } from '@shared/maas';
import type { NewApiManagedStatus } from '@shared/new-api-managed';
import type { MaasGatewayAvailability } from '@renderer/features/maas/maas-gateway-availability';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  showZenmuxUsage: vi.fn(),
  setGlobalBinding: vi.fn(),
  openMarketplace: vi.fn(),
  installLiteLlm: vi.fn(async () => undefined),
  installNewApi: vi.fn(async () => undefined),
  installCliProxyApi: vi.fn(async () => undefined),
  gatewayAvailability: 'ready' as MaasGatewayAvailability,
  connections: [] as MaasConnection[],
  liteLlmStatus: {
    state: 'not-installed',
    operation: null,
    managed: false,
    installed: false,
    dockerInstalled: true,
    dockerRunning: true,
    canStartDocker: true,
    dockerVersion: '28.0.0',
    endpoint: 'http://127.0.0.1:4000/v1',
    adminUrl: 'http://127.0.0.1:4000/ui',
    imageVersion: 'main-v1.77.7-stable',
    modelCount: null,
  } as LiteLlmManagedStatus,
  newApiStatus: {
    state: 'not-installed',
    operation: null,
    managed: false,
    installed: false,
    initialized: false,
    credentialsAvailable: false,
    dockerInstalled: true,
    dockerRunning: true,
    canStartDocker: true,
    dockerVersion: '28.0.0',
    endpoint: 'http://127.0.0.1:4001/v1',
    adminUrl: 'http://127.0.0.1:4001',
    imageVersion: 'v0.8.9-alpha.6',
    modelCount: null,
  } as NewApiManagedStatus,
  cliProxyApiStatus: {
    state: 'not-installed',
    operation: null,
    supported: true,
    managed: false,
    installed: false,
    endpoint: 'http://127.0.0.1:8317/v1',
    adminUrl: 'http://127.0.0.1:8317/management.html',
    bundledVersion: '7.2.120',
    installedVersion: null,
    modelCount: null,
  } as CliProxyApiManagedStatus,
  globalBinding: {
    platformId: null,
    enabled: false,
    effective: false,
    runtimeIds: [],
  } as MaasGlobalBindingStatus,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/maas/useMaas', () => ({
  useConnectMaasPlatform: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectMaasPlatform: () => ({ isPending: false, mutate: vi.fn() }),
  useMaasConnections: () => ({ data: mocks.connections, isLoading: false }),
  useMaasGlobalBinding: () => ({ data: mocks.globalBinding, isLoading: false }),
  useMaasPlatformDescriptions: () => ({ data: [] }),
  useSetMaasGlobalBinding: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.setGlobalBinding,
  }),
  useLiteLlmManagedStatus: () => ({
    data: mocks.liteLlmStatus,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
  }),
  useInstallLiteLlm: () => ({ isPending: false, mutateAsync: mocks.installLiteLlm }),
  useStartLiteLlm: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStopLiteLlm: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStartDockerForLiteLlm: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
  useOpenLiteLlmAdmin: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useCopyLiteLlmAdminPassword: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
  useNewApiManagedStatus: () => ({
    data: mocks.newApiStatus,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
  }),
  useInstallNewApi: () => ({ isPending: false, mutateAsync: mocks.installNewApi }),
  useInitializeNewApi: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStartNewApi: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStopNewApi: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStartDockerForNewApi: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
  useOpenNewApiAdmin: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useCopyNewApiAdminPassword: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
  useCliProxyApiManagedStatus: () => ({
    data: mocks.cliProxyApiStatus,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
  }),
  useInstallCliProxyApi: () => ({ isPending: false, mutateAsync: mocks.installCliProxyApi }),
  useStartCliProxyApi: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useStopCliProxyApi: () => ({ isPending: false, mutateAsync: vi.fn(async () => undefined) }),
  useOpenCliProxyApiAdmin: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
  useCopyCliProxyApiManagementKey: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  }),
}));

vi.mock('@renderer/features/maas/useMaasGatewayExtension', () => ({
  useMaasGatewayExtension: () => ({
    availability: mocks.gatewayAvailability,
    ready: mocks.gatewayAvailability === 'ready',
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: vi.fn(async () => {}) } },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showZenmuxUsage,
}));

describe('MaaS platform menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connections = [];
    mocks.gatewayAvailability = 'ready';
    mocks.liteLlmStatus.state = 'not-installed';
    mocks.newApiStatus.state = 'not-installed';
    mocks.cliProxyApiStatus.state = 'not-installed';
    mocks.globalBinding = {
      platformId: null,
      enabled: false,
      effective: false,
      runtimeIds: [],
    };
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

  it('separates managed gateways from the direct-provider add menu', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const addButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.addPlatform'
    );
    expect(addButton).toBeDefined();
    expect(host.textContent).toContain('maas.managedGateways.title');
    expect(host.querySelector('[data-testid="litellm-integration-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="new-api-integration-card"]')).not.toBeNull();
    expect(host.textContent).toContain('CLIProxyAPI');

    await act(async () => addButton?.click());

    const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menu?.textContent).toContain('maas.selectPlatform');
    expect(menu?.textContent).toContain('ZenMux');
    expect(menu?.textContent).not.toContain('LiteLLM');
    expect(menu?.textContent).not.toContain('New API');
    expect(menu?.textContent).not.toContain('CLIProxyAPI');
    expect(menu?.textContent).toContain('maas.categories.hosted-platform.title');
    expect(menu?.textContent).toContain('maas.categories.custom.title');
  });

  it('installs LiteLLM from its managed gateway card', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const installButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="settings.integrationsTab.litellmOneClickInstall"]'
    );
    expect(installButton).not.toBeNull();
    await act(async () => installButton?.click());
    expect(mocks.installLiteLlm).toHaveBeenCalledOnce();
  });

  it('opens requested LiteLLM connection details in the model access page', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () =>
      root.render(
        createElement(MaasView, {
          embedded: true,
          requestedPlatformId: 'litellm',
        })
      )
    );

    expect(host.querySelector('[data-maas-platform-id="litellm"]')).not.toBeNull();
  });

  it('installs New API from its managed gateway card', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const installButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="settings.integrationsTab.newApiOneClickInstall"]'
    );
    expect(installButton).not.toBeNull();
    await act(async () => installButton?.click());
    expect(mocks.installNewApi).toHaveBeenCalledOnce();
  });

  it('opens requested New API connection details in the model access page', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () =>
      root.render(
        createElement(MaasView, {
          embedded: true,
          requestedPlatformId: 'newapi',
        })
      )
    );

    expect(host.querySelector('[data-maas-platform-id="newapi"]')).not.toBeNull();
  });

  it('installs CLIProxyAPI from its managed gateway card', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const installButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="maas.managedGateways.oneClickInstall"]'
    );
    expect(installButton).not.toBeNull();
    await act(async () => installButton?.click());
    expect(mocks.installCliProxyApi).toHaveBeenCalledOnce();
  });

  it('opens connection settings for an existing CLIProxyAPI service', async () => {
    mocks.cliProxyApiStatus.state = 'external-running';
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const connectButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="maas.managedGateways.connectExisting"]'
    );
    expect(connectButton).not.toBeNull();
    await act(async () => connectButton?.click());

    expect(host.querySelector('[data-testid="maas-managed-connection-settings"]')).not.toBeNull();
    const panel = host.querySelector<HTMLElement>('[data-maas-platform-id="cliproxyapi"]');
    expect(panel).not.toBeNull();
    expect(
      Array.from(panel?.querySelectorAll<HTMLInputElement>('input') ?? []).map(
        (input) => input.value
      )
    ).toEqual(expect.arrayContaining(['CLIProxyAPI', 'http://127.0.0.1:8317/v1']));
  });

  it('can add more than one independent Custom platform draft', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const addCustomDraft = async () => {
      const addButton = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'maas.addPlatform'
      );
      await act(async () => addButton?.click());
      const customItem = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
      ).find((item) => item.textContent?.includes('Custom'));
      expect(customItem).toBeDefined();
      await act(async () => customItem?.click());
    };

    await addCustomDraft();
    await addCustomDraft();

    const customDrafts = Array.from(
      host.querySelectorAll<HTMLElement>('[data-maas-platform-id^="custom:"]')
    );
    expect(customDrafts).toHaveLength(2);
    expect(new Set(customDrafts.map((item) => item.dataset.maasPlatformId)).size).toBe(2);
  });

  it('enables and disables a configured platform from its list row', async () => {
    mocks.connections = [connection({ platformId: 'custom:first', displayName: 'First Custom' })];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const enableSwitch = host.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.global.enableAria"]'
    );
    expect(enableSwitch).not.toBeNull();
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(false);
    await act(async () => enableSwitch?.click());
    expect(mocks.setGlobalBinding).toHaveBeenLastCalledWith(
      { platformId: 'custom:first', enabled: true },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );

    mocks.globalBinding = {
      platformId: 'custom:first',
      enabled: true,
      effective: true,
      runtimeIds: ['codex'],
    };
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const disableSwitch = host.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.global.disableAria"]'
    );
    expect(disableSwitch).not.toBeNull();
    await act(async () => disableSwitch?.click());
    expect(mocks.setGlobalBinding).toHaveBeenLastCalledWith(
      { platformId: 'custom:first', enabled: false },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it('does not enable a saved platform whose local credential is missing', async () => {
    mocks.connections = [
      connection({
        platformId: 'custom:first',
        displayName: 'First Custom',
        keyFingerprint: null,
        inferenceKeyFingerprint: null,
        connected: false,
      }),
    ];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const enableSwitch = host.querySelector<HTMLElement>('[data-slot="switch"]');
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(true);
  });

  it('keeps the Settings MaaS switch disabled until Gateway is installed', async () => {
    mocks.gatewayAvailability = 'not-installed';
    mocks.connections = [connection({ platformId: 'custom:first', displayName: 'First Custom' })];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () =>
      root.render(
        createElement(MaasView, {
          embedded: true,
          onOpenMarketplace: mocks.openMarketplace,
        })
      )
    );

    const enableSwitch = host.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.global.enableAria"]'
    );
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(true);
    expect(host.querySelector('[data-maas-gateway-requirement="not-installed"]')).not.toBeNull();
    const installButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.gatewayRequirement.install'
    );
    await act(async () => installButton?.click());
    expect(mocks.openMarketplace).toHaveBeenCalledOnce();
    expect(mocks.setGlobalBinding).not.toHaveBeenCalled();
  });

  it('keeps the bottom-bar selector disabled until Gateway is installed', async () => {
    mocks.gatewayAvailability = 'not-installed';
    mocks.connections = [connection({ platformId: 'custom:first', displayName: 'First Custom' })];
    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () =>
      root.render(
        createElement(MaasGlobalSelector, {
          onOpenMarketplace: mocks.openMarketplace,
        })
      )
    );

    const enableCheckbox = host.querySelector<HTMLElement>(
      '[data-slot="checkbox"][aria-label="maas.global.toggleAria"]'
    );
    expect(enableCheckbox?.hasAttribute('data-disabled')).toBe(true);
    expect(host.querySelector('[data-maas-gateway-requirement="not-installed"]')).not.toBeNull();
  });
});

function connection(overrides: Partial<MaasConnection> = {}): MaasConnection {
  return {
    platformId: 'zenmux',
    displayName: 'ZenMux',
    endpoint: 'https://zenmux.ai/api/v1',
    keyFingerprint: 'ke...ey',
    inferenceKeyFingerprint: 'ke...ey',
    connectedAt: '2026-07-25T00:00:00.000Z',
    lastCheckedAt: null,
    configured: true,
    connected: true,
    error: null,
    ...overrides,
  };
}
