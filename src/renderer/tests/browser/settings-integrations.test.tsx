import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOVCODE_DOWNLOAD_URL, type LovcodeAvailability } from '@shared/lovcode';
import type { MaasConnection } from '@shared/maas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openLiteLlm: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  checkLovcodeAvailability: vi.fn<() => Promise<LovcodeAvailability>>(),
  checkGithubStatus: vi.fn(async () => ({})),
  maasConnections: [] as MaasConnection[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { name?: string; version?: string }) =>
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
    mocks.checkLovcodeAvailability.mockResolvedValue({ status: 'not-installed' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows LiteLLM and opens its MaaS configuration directly', async () => {
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () =>
      root.render(createElement(IntegrationsCard, { onOpenLiteLlm: mocks.openLiteLlm }))
    );

    expect(host.textContent).toContain('LiteLLM');
    expect(host.textContent).toContain('settings.integrationsTab.litellmDescription');

    const connectButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.connect:LiteLLM"]'
    );
    expect(connectButton).not.toBeNull();
    await act(async () => connectButton?.click());
    expect(mocks.openLiteLlm).toHaveBeenCalledOnce();
  });

  it('shows the saved LiteLLM Gateway and opens its settings', async () => {
    mocks.maasConnections = [
      {
        platformId: 'litellm',
        displayName: 'LiteLLM',
        endpoint: 'http://127.0.0.1:4000/v1',
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

    expect(host.textContent).toContain('settings.integrationsTab.litellmConnectedDescription');
    const settingsButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.openSettings:LiteLLM"]'
    );
    expect(settingsButton).not.toBeNull();
    await act(async () => settingsButton?.click());
    expect(mocks.openLiteLlm).toHaveBeenCalledOnce();
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
