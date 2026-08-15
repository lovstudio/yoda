import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { CliProxyApiManagedStatus } from '@shared/cliproxyapi-managed';
import type { LiteLlmManagedStatus } from '@shared/litellm-managed';
import type {
  MaasCodexClientSyncStatus,
  MaasConnection,
  MaasGlobalBindingStatus,
  MaasManagedGatewayStarSnapshot,
} from '@shared/maas';
import type { NewApiManagedStatus } from '@shared/new-api-managed';
import type { MaasGatewayAvailability } from '@renderer/features/maas/maas-gateway-availability';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  showZenmuxUsage: vi.fn(),
  showAddProfile: vi.fn(),
  showConfirm: vi.fn(),
  clearCodexClientSync: vi.fn(),
  setCodexClientSync: vi.fn(),
  setGlobalBinding: vi.fn(),
  connectPlatform: vi.fn(),
  checkConnection: vi.fn(),
  duplicateProfile: vi.fn(),
  reorderConnections: vi.fn(),
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
  codexClientSyncStatus: {
    supported: true,
    enabled: false,
    managed: false,
    configManaged: false,
    environmentPublished: false,
    persistentCredentialStored: false,
    loginItemEnabled: false,
    platformId: null,
    displayName: null,
    envKey: null,
    persistsAfterQuit: true,
    claude: {
      supported: true,
      compatible: false,
      managed: false,
      configManaged: false,
      persistentCredentialStored: false,
    },
  } as MaasCodexClientSyncStatus,
  managedGatewayStars: [
    {
      platformId: 'litellm',
      repositoryUrl: 'https://github.com/BerriAI/litellm',
      starCount: 12_345,
      fetchedAt: '2026-08-10T00:00:00.000Z',
      trend: {
        points: [
          { date: '2023-08-14', starCount: 10_000 },
          { date: '2026-08-03', starCount: 12_345 },
        ],
        source: 'ossinsight',
        calibratedToCurrent: true,
        fetchedAt: '2026-08-10T00:00:00.000Z',
      },
    },
    {
      platformId: 'cliproxyapi',
      repositoryUrl: 'https://github.com/router-for-me/CLIProxyAPI',
      starCount: 6_789,
      fetchedAt: '2026-08-10T00:00:00.000Z',
      trend: {
        points: [
          { date: '2023-08-14', starCount: 4_321 },
          { date: '2026-08-03', starCount: 6_789 },
        ],
        source: 'ossinsight',
        calibratedToCurrent: true,
        fetchedAt: '2026-08-10T00:00:00.000Z',
      },
    },
    {
      platformId: 'newapi',
      repositoryUrl: 'https://github.com/QuantumNous/new-api',
      starCount: 456,
      fetchedAt: '2026-08-10T00:00:00.000Z',
      trend: {
        points: [
          { date: '2023-08-14', starCount: 123 },
          { date: '2026-08-03', starCount: 456 },
        ],
        source: 'ossinsight',
        calibratedToCurrent: true,
        fetchedAt: '2026-08-10T00:00:00.000Z',
      },
    },
  ] as MaasManagedGatewayStarSnapshot[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@renderer/features/maas/useMaas', () => ({
  useConnectMaasPlatform: () => ({ isPending: false, mutate: mocks.connectPlatform }),
  useCheckMaasConnection: () => ({ isPending: false, mutate: mocks.checkConnection }),
  useDisconnectMaasPlatform: () => ({ isPending: false, mutate: vi.fn() }),
  useDuplicateMaasProfile: () => ({ isPending: false, mutate: mocks.duplicateProfile }),
  useReorderMaasConnections: () => ({ isPending: false, mutate: mocks.reorderConnections }),
  useMaasConnections: () => ({ data: mocks.connections, isLoading: false }),
  useMaasGlobalBinding: () => ({ data: mocks.globalBinding, isLoading: false }),
  useMaasManagedGatewayStars: () => ({ data: mocks.managedGatewayStars, isPending: false }),
  useMaasPlatformDescriptions: () => ({ data: [] }),
  useSetMaasGlobalBinding: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.setGlobalBinding,
  }),
  useCodexClientSyncStatus: () => ({
    data: mocks.codexClientSyncStatus,
    isLoading: false,
  }),
  useClearCodexClientSync: () => ({
    isPending: false,
    mutate: mocks.clearCodexClientSync,
  }),
  useSetCodexClientSync: () => ({
    isPending: false,
    mutate: mocks.setCodexClientSync,
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

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    dependencies: {
      agentStatuses: {
        codex: { status: 'available' },
        claude: { status: 'available' },
      },
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: (id: string) =>
    id === 'confirmActionModal'
      ? (args: { onSuccess?: () => void }) => {
          mocks.showConfirm(args);
          args.onSuccess?.();
        }
      : id === 'addMaasProfileModal'
        ? mocks.showAddProfile
        : mocks.showZenmuxUsage,
}));

describe('MaaS platform menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connections = [];
    mocks.gatewayAvailability = 'ready';
    mocks.codexClientSyncStatus = {
      supported: true,
      enabled: false,
      managed: false,
      configManaged: false,
      environmentPublished: false,
      persistentCredentialStored: false,
      loginItemEnabled: true,
      platformId: null,
      displayName: null,
      envKey: null,
      persistsAfterQuit: true,
      claude: {
        supported: true,
        compatible: false,
        managed: false,
        configManaged: false,
        persistentCredentialStored: false,
      },
    };
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

  it('shows cloud profiles before local integrations and opens the generic Profile flow', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const addButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.addProfile'
    );
    expect(addButton).toBeDefined();
    expect(host.textContent).not.toContain('maas.addedCount');
    expect(host.textContent).not.toContain('maas.activeCount');
    expect(host.textContent?.indexOf('maas.cloudProfiles.title')).toBeLessThan(
      host.textContent?.indexOf('maas.managedGateways.title') ?? 0
    );
    expect(host.textContent).toContain('maas.managedGateways.title');
    expect(host.querySelector('[data-testid="litellm-integration-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="new-api-integration-card"]')).not.toBeNull();
    expect(host.textContent).toContain('CLIProxyAPI');
    const localCards = host.querySelector('[data-testid="maas-managed-gateway-cards"]');
    expect(localCards?.textContent?.indexOf('LiteLLM')).toBeLessThan(
      localCards?.textContent?.indexOf('CLIProxyAPI') ?? 0
    );
    expect(localCards?.textContent?.indexOf('CLIProxyAPI')).toBeLessThan(
      localCards?.textContent?.indexOf('New API') ?? 0
    );
    expect(localCards?.textContent).toContain('12,345');
    expect(localCards?.textContent).toContain('6,789');
    expect(localCards?.textContent).toContain('456');
    expect(host.querySelector('[data-testid="maas-managed-gateway-star-trend"]')).not.toBeNull();
    expect(host.querySelectorAll('polyline[data-maas-star-trend]')).toHaveLength(3);

    await act(async () => addButton?.click());
    expect(mocks.showAddProfile).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
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

  it('can add more than one independent generic Profile draft', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const addProfileDraft = async (displayName: string) => {
      const addButton = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'maas.addProfile'
      );
      await act(async () => addButton?.click());
      const call = mocks.showAddProfile.mock.calls.at(-1)?.[0] as
        | { onSuccess?: (draft: unknown) => void }
        | undefined;
      await act(async () =>
        call?.onSuccess?.({
          displayName,
          endpoint: 'https://example.test/v1',
          websiteUrl: 'https://example.test',
        })
      );
    };

    await addProfileDraft('Example 1');
    await addProfileDraft('Example 2');

    const customDrafts = Array.from(
      host.querySelectorAll<HTMLElement>('[data-maas-platform-id^="profile:"]')
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

  it('keeps the Profile header focused on its name, last valid check, switch, and actions', async () => {
    mocks.connections = [
      connection({
        lastCheckedAt: '2026-08-12T03:30:00.000Z',
        lastTest: {
          ok: true,
          error: null,
          checkedAt: '2026-08-12T03:30:00.000Z',
          averageLatencyMs: 15,
          samples: [
            { durationMs: 14, ok: true, error: null },
            { durationMs: 15, ok: true, error: null },
            { durationMs: 16, ok: true, error: null },
          ],
        },
      }),
    ];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="zenmux"]');
    expect(profile?.textContent).toContain('ZenMux');
    expect(profile?.textContent).toContain('maas.connection.lastVerified');
    expect(profile?.textContent).toContain('maas.connection.testSpeed');
    expect(profile?.textContent).not.toContain('maas.platforms.zenmux.description');
    expect(profile?.textContent).not.toContain('maas.global.enabled');
    expect(profile?.textContent).not.toContain('maas.global.disabled');
    expect(
      profile?.querySelector('[data-testid="maas-profile-last-activity"] time')
    ).not.toBeNull();
    expect(profile?.querySelector('[data-slot="switch"]')).not.toBeNull();
    expect(profile?.querySelector('[aria-label="maas.connection.test"]')).not.toBeNull();
    expect(profile?.querySelector('[aria-label="maas.profile.actions"]')).not.toBeNull();

    const profileTrigger = profile?.querySelector<HTMLButtonElement>('h3 > button');
    await act(async () => profileTrigger?.click());
    const basic = profile?.querySelector<HTMLElement>('[data-testid="maas-basic-settings"]');
    expect(basic?.textContent).toContain('maas.connection.displayName');
    expect(basic?.textContent).toContain('maas.connection.endpoint');
    expect(basic?.textContent).toContain('maas.connection.clientApiKey');
    expect(profile?.querySelector('[data-testid="maas-advanced-settings"]')).toBeNull();
    expect(profile?.textContent).toContain('maas.connection.advancedSummaryWithManagement');
    expect(profile?.textContent).not.toContain('maas.connection.testWithLatency');

    const advancedTrigger = Array.from(profile?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('maas.connection.advanced')
    );
    await act(async () => advancedTrigger?.click());
    const advanced = profile?.querySelector<HTMLElement>('[data-testid="maas-advanced-settings"]');
    expect(advanced?.textContent).toContain('maas.connection.envKey');
    expect(advanced?.textContent).toContain('maas.connection.managementApiKey');
    expect(advanced?.textContent).not.toContain('maas.connection.syncToAgentClient');
    const advancedSection = profile?.querySelector<HTMLElement>(
      '[data-testid="maas-advanced-section"]'
    );
    const profileActions = profile?.querySelector<HTMLElement>('[role="toolbar"]');
    expect(profileActions).not.toBeNull();
    if (!profileActions) throw new Error('Profile actions were not rendered');
    expect(advancedSection?.contains(profileActions)).toBe(false);
  });

  it('keeps test in the header and shows save only while configuration is dirty', async () => {
    mocks.connections = [connection()];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="zenmux"]');
    await act(async () => profile?.querySelector<HTMLButtonElement>('h3 > button')?.click());

    const basic = profile?.querySelector<HTMLElement>('[data-testid="maas-basic-settings"]');
    const [nameInput, endpointInput] = Array.from(
      basic?.querySelectorAll<HTMLInputElement>('input') ?? []
    );
    const getTestButton = () =>
      profile?.querySelector<HTMLButtonElement>('[data-testid="maas-profile-test"]');
    const getSaveButton = () =>
      profile?.querySelector<HTMLButtonElement>('[data-testid="maas-profile-save"]');

    expect(getTestButton()?.disabled).toBe(false);
    expect(getSaveButton()).toBeNull();
    await act(async () => getTestButton()?.click());
    expect(mocks.checkConnection).toHaveBeenCalledWith(
      'zenmux',
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );

    await act(async () => setInputValue(nameInput!, ''));
    expect(getTestButton()?.disabled).toBe(true);
    expect(getSaveButton()?.disabled).toBe(true);

    await act(async () => setInputValue(nameInput!, 'ZenMux'));
    await act(async () => setInputValue(endpointInput!, ''));
    expect(getTestButton()?.disabled).toBe(true);
    expect(getSaveButton()?.disabled).toBe(true);

    await act(async () => setInputValue(endpointInput!, 'https://zenmux.ai/api/v1'));
    expect(getSaveButton()).toBeNull();
    const replaceClientKey = basic?.querySelector<HTMLButtonElement>(
      '[aria-label="maas.connection.replaceKey"]'
    );
    await act(async () => replaceClientKey?.click());
    const clientKeyInput = Array.from(
      basic?.querySelectorAll<HTMLInputElement>('input') ?? []
    ).find((input) => input.type === 'password');
    expect(getTestButton()?.disabled).toBe(true);
    expect(getSaveButton()?.disabled).toBe(true);

    await act(async () => setInputValue(clientKeyInput!, 'sk-test'));
    expect(getTestButton()?.disabled).toBe(true);
    expect(getSaveButton()?.disabled).toBe(false);
    await act(async () => getSaveButton()?.click());
    expect(mocks.connectPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: 'zenmux',
        displayName: 'ZenMux',
        endpoint: 'https://zenmux.ai/api/v1',
        inferenceApiKey: 'sk-test',
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it('stores a separate New API account credential without changing the Client key', async () => {
    mocks.connections = [
      connection({
        platformId: 'profile:lovbrowser',
        displayName: 'LovBrowser',
        endpoint: 'https://newapi.1234bot.com/v1',
        accountKeyFingerprint: null,
      }),
    ];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="profile:lovbrowser"]');
    await act(async () => profile?.querySelector<HTMLButtonElement>('h3 > button')?.click());
    const advancedTrigger = Array.from(profile?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('maas.connection.advanced')
    );
    await act(async () => advancedTrigger?.click());

    const accountInput = profile?.querySelector<HTMLInputElement>(
      'input[placeholder="maas.connection.accountUsageCredentialPlaceholder"]'
    );
    expect(accountInput).not.toBeNull();
    expect(profile?.textContent).toContain('maas.connection.accountUsageCredentialHelper');
    await act(async () => setInputValue(accountInput!, 'account-access-token'));

    const saveButton = profile?.querySelector<HTMLButtonElement>(
      '[data-testid="maas-profile-save"]'
    );
    expect(saveButton?.disabled).toBe(false);
    await act(async () => saveButton?.click());
    expect(mocks.connectPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: 'profile:lovbrowser',
        accountAccessToken: 'account-access-token',
        apiKey: undefined,
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it('requires a successful connection test before enabling a Profile from either surface', async () => {
    mocks.connections = [
      connection({
        platformId: 'custom:first',
        displayName: 'First Custom',
        lastTest: {
          ok: false,
          error: 'HTTP 401',
          checkedAt: '2026-08-13T00:00:00.000Z',
          samples: [{ durationMs: 12, ok: false, error: 'HTTP 401' }],
          averageLatencyMs: null,
        },
      }),
    ];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const enableSwitch = host.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.global.enableAria"]'
    );
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(true);
    expect(enableSwitch?.getAttribute('title')).toBe('maas.global.needsSuccessfulTest');

    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () => root.render(createElement(MaasGlobalSelector)));
    const selector = host.querySelector<HTMLButtonElement>(
      '[data-slot="dropdown-menu-trigger"][aria-label="maas.global.title"]'
    );
    expect(selector).not.toBeNull();
    expect(host.querySelector('[data-slot="checkbox"]')).toBeNull();
    await userEvent.click(selector!);
    const profileOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('First Custom'));
    const profileSwitch = profileOption?.querySelector<HTMLElement>('[data-slot="switch"]');
    expect(profileSwitch?.hasAttribute('data-disabled')).toBe(true);
    expect(profileOption?.textContent).toContain('maas.global.needsSuccessfulTest');
  });

  it('groups Profile duplication, documentation, usage, and remove actions in one menu', async () => {
    mocks.connections = [connection()];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const actions = host.querySelector<HTMLButtonElement>('[aria-label="maas.profile.actions"]');
    await act(async () => actions?.click());
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menu?.textContent).toContain('maas.connection.openDocs');
    expect(menu?.textContent).toContain('maas.profile.duplicate');
    expect(menu?.textContent).toContain('maas.records.viewUsage');
    expect(menu?.textContent).toContain('maas.connection.disconnect');

    const duplicate = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    ).find((item) => item.textContent?.includes('maas.profile.duplicate'));
    await act(async () => duplicate?.click());
    expect(mocks.duplicateProfile).toHaveBeenCalledWith(
      { platformId: 'zenmux', displayName: 'maas.profile.duplicateName' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it('derives a distinct environment key from a renamed Profile and keeps it in advanced settings', async () => {
    mocks.connections = [
      connection({
        platformId: 'zenmux:secondary',
        displayName: 'ZenMux 2',
        envKey: 'ZENMUX_API_KEY',
      }),
    ];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="zenmux:secondary"]');
    await act(async () => profile?.querySelector<HTMLButtonElement>('h3 > button')?.click());
    const advancedTrigger = Array.from(profile?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('maas.connection.advanced')
    );
    await act(async () => advancedTrigger?.click());

    const advanced = profile?.querySelector<HTMLElement>('[data-testid="maas-advanced-settings"]');
    expect(advanced?.querySelector<HTMLInputElement>('input')?.value).toBe('ZENMUX_2_API_KEY');
  });

  it('keeps the expanded Profile within a 440px container', async () => {
    host.style.width = '440px';
    mocks.connections = [connection()];
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="zenmux"]');
    await act(async () => profile?.querySelector<HTMLButtonElement>('h3 > button')?.click());
    const advancedTrigger = Array.from(profile?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('maas.connection.advanced')
    );
    await act(async () => advancedTrigger?.click());

    expect(profile).not.toBeNull();
    expect(profile!.scrollWidth).toBeLessThanOrEqual(profile!.clientWidth + 1);
  });

  it('keeps the global sync panel within a 440px container', async () => {
    host.style.width = '440px';
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const syncSettings = host.querySelector<HTMLElement>(
      '[data-testid="external-agent-sync-settings"]'
    );
    expect(syncSettings).not.toBeNull();
    expect(syncSettings!.scrollWidth).toBeLessThanOrEqual(syncSettings!.clientWidth + 1);
  });

  it('manages external Agent App sync as one global MaaS setting', async () => {
    mocks.connections = [
      connection({
        platformId: 'custom:lovstudio',
        displayName: 'LovStudio LLM',
        endpoint: 'https://llm.lovstudio.test/v1',
        envKey: 'LOVSTUDIO_LLM_API_KEY',
      }),
    ];
    mocks.globalBinding = {
      platformId: 'custom:lovstudio',
      enabled: true,
      effective: true,
      runtimeIds: ['codex'],
    };
    mocks.codexClientSyncStatus = {
      ...mocks.codexClientSyncStatus,
      platformId: 'custom:lovstudio',
      displayName: 'LovStudio LLM',
      envKey: 'LOVSTUDIO_LLM_API_KEY',
    };
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const syncSettings = host.querySelector<HTMLElement>(
      '[data-testid="external-agent-sync-settings"]'
    );
    expect(syncSettings?.textContent).toContain('maas.clientSync.agentClientAdapters');
    expect(syncSettings?.textContent).toContain('Codex CLI / App');
    expect(syncSettings?.textContent).toContain('maas.clientSync.adapted');
    expect(syncSettings?.textContent).toContain('Claude Code');
    expect(syncSettings?.textContent).toContain('maas.clientSync.adapted');
    const syncSwitch = syncSettings?.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.clientSync.toggle"]'
    );
    expect(syncSwitch).not.toBeNull();
    await act(async () => syncSwitch?.click());
    expect(mocks.showConfirm).toHaveBeenCalledOnce();
    expect(mocks.setCodexClientSync).toHaveBeenCalledWith({ enabled: true }, expect.any(Object));
    expect(mocks.connectPlatform).not.toHaveBeenCalled();
  });

  it('renders an older Client sync payload without the Claude status extension', async () => {
    const { claude: _claude, ...legacyStatus } = mocks.codexClientSyncStatus;
    mocks.codexClientSyncStatus = legacyStatus as MaasCodexClientSyncStatus;

    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    expect(host.querySelector('[data-testid="external-agent-sync-settings"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="external-agent-client-claude"]')).not.toBeNull();
  });

  it('shows the active global sync state independently from Profile settings', async () => {
    mocks.codexClientSyncStatus = {
      supported: true,
      enabled: true,
      managed: true,
      configManaged: true,
      environmentPublished: false,
      persistentCredentialStored: true,
      loginItemEnabled: false,
      platformId: 'zenmux',
      displayName: 'ZenMux',
      envKey: null,
      persistsAfterQuit: true,
      claude: {
        supported: true,
        compatible: true,
        managed: true,
        configManaged: true,
        persistentCredentialStored: true,
      },
    };
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const syncSettings = host.querySelector<HTMLElement>(
      '[data-testid="external-agent-sync-settings"]'
    );
    expect(syncSettings?.textContent).toContain('maas.clientSync.activeDetail');
    expect(syncSettings?.textContent).toContain('maas.clientSync.risk');
    expect(syncSettings?.querySelector('[data-slot="switch"][data-checked]')).not.toBeNull();
  });

  it('does not expose the retired macOS login-item control', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const loginItemSwitch = host.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.clientSync.loginItemToggle"]'
    );
    expect(loginItemSwitch).toBeNull();
  });

  it('keeps the inactive sync summary quiet and non-actionable', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const syncSettings = host.querySelector<HTMLElement>(
      '[data-testid="external-agent-sync-settings"]'
    );
    expect(syncSettings?.textContent).toContain('maas.clientSync.inactiveDetail');
    expect(syncSettings?.textContent).not.toContain('maas.clientSync.risk');
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

    const profile = host.querySelector<HTMLElement>('[data-maas-platform-id="custom:first"]');
    const enableSwitch = profile?.querySelector<HTMLElement>(
      '[data-slot="switch"][aria-label="maas.global.enableAria"]'
    );
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(true);
  });

  it('allows a configured remote Profile without the optional local Gateway', async () => {
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
    expect(enableSwitch?.hasAttribute('data-disabled')).toBe(false);
    expect(host.querySelector('[data-maas-gateway-requirement]')).toBeNull();
    await act(async () => enableSwitch?.click());
    expect(mocks.setGlobalBinding).toHaveBeenCalledWith(
      { platformId: 'custom:first', enabled: true },
      expect.any(Object)
    );
  });

  it('uses a compact selector for remote Profiles and keeps configuration adjacent', async () => {
    mocks.gatewayAvailability = 'not-installed';
    mocks.connections = [
      connection({ platformId: 'custom:first', displayName: 'First Custom' }),
      connection({ platformId: 'custom:second', displayName: 'Second Custom' }),
    ];
    mocks.globalBinding = {
      platformId: 'custom:first',
      enabled: true,
      effective: true,
      runtimeIds: ['codex'],
    };
    const onManagePlatform = vi.fn();
    const { MaasGlobalSelector } = await import(
      '@renderer/features/maas/components/MaasGlobalSelector'
    );
    await act(async () =>
      root.render(
        createElement(MaasGlobalSelector, {
          onOpenMarketplace: mocks.openMarketplace,
          onManagePlatform,
        })
      )
    );

    const selector = host.querySelector<HTMLButtonElement>(
      '[data-slot="dropdown-menu-trigger"][aria-label="maas.global.title"]'
    );
    expect(selector?.textContent).toContain('First Custom');
    expect(selector?.textContent).toContain('maas.global.effective');
    expect(host.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(host.querySelector('[data-maas-gateway-requirement]')).toBeNull();

    await userEvent.click(selector!);
    const secondProfile = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('Second Custom'));
    const enableSwitch = secondProfile?.querySelector<HTMLElement>('[data-slot="switch"]');
    await act(async () => enableSwitch?.click());
    expect(mocks.setGlobalBinding).toHaveBeenCalledWith(
      { platformId: 'custom:second', enabled: true },
      expect.any(Object)
    );

    const manageButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="maas.global.manage"]'
    );
    await act(async () => manageButton?.click());
    expect(onManagePlatform).toHaveBeenCalledWith('custom:first');
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
    lastCheckedAt: '2026-08-13T00:00:00.000Z',
    lastTest: {
      ok: true,
      error: null,
      checkedAt: '2026-08-13T00:00:00.000Z',
      samples: [{ durationMs: 12, ok: true, error: null }],
      averageLatencyMs: 12,
    },
    configured: true,
    connected: true,
    error: null,
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
