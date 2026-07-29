import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LITELLM_DOCKER_DESKTOP_URL, type LiteLlmManagedStatus } from '@shared/litellm-managed';
import { LOVCODE_DOWNLOAD_URL, type LovcodeAvailability } from '@shared/lovcode';
import type { MaasConnection } from '@shared/maas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openLiteLlm: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  checkLovcodeAvailability: vi.fn<() => Promise<LovcodeAvailability>>(),
  checkGithubStatus: vi.fn(async () => ({})),
  maasConnections: [] as MaasConnection[],
  liteLlmStatus: null as LiteLlmManagedStatus | null,
  refetchLiteLlmStatus: vi.fn(async () => undefined),
  installLiteLlm: vi.fn(async () => undefined),
  startLiteLlm: vi.fn(async () => undefined),
  stopLiteLlm: vi.fn(async () => undefined),
  startDockerForLiteLlm: vi.fn(async () => undefined),
  openLiteLlmAdmin: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (
      key: string,
      values?: { name?: string; version?: string; endpoint?: string; count?: number }
    ) =>
      values?.name ? `${key}:${values.name}` : values?.version ? `${key}:${values.version}` : key,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { openExternal: mocks.openExternal },
    lovcode: { checkAvailability: mocks.checkLovcodeAvailability },
  },
}));

vi.mock('@renderer/features/maas/useMaas', () => ({
  useMaasConnections: () => ({ data: mocks.maasConnections, isLoading: false }),
  useLiteLlmManagedStatus: () => ({
    data: mocks.liteLlmStatus,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchLiteLlmStatus,
  }),
  useInstallLiteLlm: () => ({ mutateAsync: mocks.installLiteLlm, isPending: false }),
  useStartLiteLlm: () => ({ mutateAsync: mocks.startLiteLlm, isPending: false }),
  useStopLiteLlm: () => ({ mutateAsync: mocks.stopLiteLlm, isPending: false }),
  useStartDockerForLiteLlm: () => ({
    mutateAsync: mocks.startDockerForLiteLlm,
    isPending: false,
  }),
  useOpenLiteLlmAdmin: () => ({ mutateAsync: mocks.openLiteLlmAdmin, isPending: false }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@renderer/features/integrations/integrations-provider', () => ({
  useIntegrationsContext: () => ({
    connectionStatus: {
      linear: {},
      jira: {},
      gitlab: {},
      plain: {},
      forgejo: {},
      featurebase: {},
    },
    isLinearConnected: false,
    isLinearLoading: false,
    disconnectLinear: vi.fn(),
    isJiraConnected: false,
    isJiraLoading: false,
    disconnectJira: vi.fn(),
    isGitlabConnected: false,
    isGitlabLoading: false,
    disconnectGitlab: vi.fn(),
    isPlainConnected: false,
    isPlainLoading: false,
    disconnectPlain: vi.fn(),
    isForgejoConnected: false,
    isForgejoLoading: false,
    disconnectForgejo: vi.fn(),
    isFeaturebaseConnected: false,
    isFeaturebaseLoading: false,
    disconnectFeaturebase: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/providers/github-context-provider', () => ({
  useGithubContext: () => ({
    authenticated: false,
    isLoading: false,
    githubLoading: false,
    handleGithubConnect: vi.fn(),
    cancelGithubConnect: vi.fn(),
    logout: vi.fn(),
    tokenSource: null,
    checkStatus: mocks.checkGithubStatus,
  }),
}));

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

describe('Settings integrations', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maasConnections = [];
    mocks.liteLlmStatus = {
      state: 'not-installed',
      operation: null,
      managed: false,
      installed: false,
      dockerInstalled: true,
      dockerRunning: true,
      canStartDocker: true,
      dockerVersion: 'Docker version 28.0.0',
      endpoint: 'http://127.0.0.1:4000/v1',
      adminUrl: 'http://127.0.0.1:4000/ui',
      imageVersion: 'v1.90.2',
      modelCount: null,
    };
    mocks.checkLovcodeAvailability.mockResolvedValue({ status: 'not-installed' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('offers a real one-click LiteLLM installation instead of opening a blank MaaS form', async () => {
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('LiteLLM');
    expect(host.textContent).toContain('settings.integrationsTab.litellmManagedDescription');

    const installButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmOneClickInstall')
    );
    expect(installButton).toBeDefined();
    await act(async () => installButton?.click());
    expect(mocks.installLiteLlm).toHaveBeenCalledOnce();
    expect(mocks.openLiteLlm).not.toHaveBeenCalled();
  });

  it('keeps an existing remote LiteLLM connection manageable without replacing it', async () => {
    mocks.maasConnections = [
      {
        platformId: 'litellm',
        displayName: 'LiteLLM',
        endpoint: 'https://gateway.example.com/v1',
        keyFingerprint: 'sk...test',
        inferenceKeyFingerprint: 'sk...test',
        connectedAt: '2026-07-29T00:00:00.000Z',
        lastCheckedAt: '2026-07-29T00:00:00.000Z',
        configured: true,
        connected: true,
        error: null,
      },
    ];
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain(
      'settings.integrationsTab.litellmRemoteConnectedDescription'
    );
    const settingsButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmManageConnection')
    );
    expect(settingsButton).toBeDefined();
    await act(async () => settingsButton?.click());
    expect(mocks.openLiteLlm).toHaveBeenCalledOnce();
  });

  it('downloads Docker Desktop when the one-click runtime dependency is missing', async () => {
    mocks.liteLlmStatus = {
      ...mocks.liteLlmStatus!,
      state: 'docker-missing',
      dockerInstalled: false,
      dockerRunning: false,
    };
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    const downloadButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmDownloadDocker')
    );
    expect(downloadButton).toBeDefined();
    await act(async () => downloadButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(LITELLM_DOCKER_DESKTOP_URL);
  });

  it('keeps checking while Docker Desktop starts instead of showing a timeout failure', async () => {
    mocks.liteLlmStatus = {
      ...mocks.liteLlmStatus!,
      state: 'docker-starting',
      dockerRunning: false,
    };
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('settings.integrationsTab.litellmDockerStartingDescription');
    expect(host.textContent).toContain('settings.integrationsTab.litellmStartingDocker');
    const startingButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmStartingDocker')
    );
    expect(startingButton?.disabled).toBe(true);
  });

  it('keeps installation progress visible after revisiting settings', async () => {
    mocks.liteLlmStatus = {
      ...mocks.liteLlmStatus!,
      state: 'stopped',
      operation: 'installing',
      installed: true,
      managed: true,
    };
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('settings.integrationsTab.litellmInstallingDescription');
    expect(host.textContent).toContain('settings.integrationsTab.litellmStatusInstalling');
    const progressButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmInstalling')
    );
    expect(progressButton?.disabled).toBe(true);
    expect(mocks.installLiteLlm).not.toHaveBeenCalled();
    expect(mocks.startLiteLlm).not.toHaveBeenCalled();
  });

  it('opens the managed console with copied credentials and can stop the local gateway', async () => {
    mocks.liteLlmStatus = {
      ...mocks.liteLlmStatus!,
      state: 'running',
      managed: true,
      installed: true,
      modelCount: 0,
    };
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('settings.integrationsTab.litellmNeedsModelDescription');
    const addModelButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.integrationsTab.litellmAddFirstModel')
    );
    await act(async () => addModelButton?.click());
    expect(mocks.openLiteLlmAdmin).toHaveBeenCalledOnce();

    const stopButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.litellmStop"]'
    );
    await act(async () => stopButton?.click());
    expect(mocks.stopLiteLlm).toHaveBeenCalledOnce();
  });

  it('shows Lovcode and opens the download page when it is not installed', async () => {
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('Lovcode');
    expect(host.textContent).toContain('settings.integrationsTab.lovcodeDescription');

    const installButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.install:Lovcode"]'
    );
    expect(installButton).not.toBeNull();
    await act(async () => installButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(LOVCODE_DOWNLOAD_URL);
  });

  it('shows the detected Lovcode version and refreshes detection when Yoda regains focus', async () => {
    mocks.checkLovcodeAvailability
      .mockResolvedValueOnce({ status: 'not-installed' })
      .mockResolvedValueOnce({
        status: 'available',
        version: 'lovcode 0.40.0',
      });
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('settings.integrationsTab.lovcodeDescription');
    await act(async () => window.dispatchEvent(new Event('focus')));

    expect(host.textContent).toContain('settings.integrationsTab.lovcodeConnectedDescription');
    expect(host.textContent).toContain('lovcode 0.40.0');
    expect(
      host.querySelector('[aria-label="settings.integrationsTab.lovcodeInstalledTooltip"]')
    ).not.toBeNull();
    expect(mocks.checkLovcodeAvailability).toHaveBeenCalledTimes(2);
  });

  it('acknowledges a desktop-only Lovcode app and hides the download action', async () => {
    mocks.checkLovcodeAvailability.mockResolvedValue({
      status: 'desktop-only',
      version: '0.39.9',
    });
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain(
      'settings.integrationsTab.lovcodeDesktopConnectedDescription'
    );
    expect(host.textContent).toContain('0.39.9');
    expect(
      host.querySelector('[aria-label="settings.integrationsTab.lovcodeDesktopTooltip"]')
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="settings.integrationsTab.install:Lovcode"]')
    ).toBeNull();
  });

  it('offers an upgrade when the installed Lovcode predates global search', async () => {
    mocks.checkLovcodeAvailability.mockResolvedValue({
      status: 'upgrade-required',
      version: '0.39.9',
    });
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('settings.integrationsTab.lovcodeUpgradeDescription:0.39.9');
    const upgradeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.upgrade:Lovcode"]'
    );
    expect(upgradeButton).not.toBeNull();
    await act(async () => upgradeButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(LOVCODE_DOWNLOAD_URL);
  });
});
