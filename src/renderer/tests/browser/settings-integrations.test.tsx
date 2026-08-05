import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOVCODE_DOWNLOAD_URL, type LovcodeAvailability } from '@shared/lovcode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  checkLovcodeAvailability: vi.fn<() => Promise<LovcodeAvailability>>(),
  checkGithubStatus: vi.fn(async () => ({})),
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
    mocks.checkLovcodeAvailability.mockResolvedValue({ status: 'not-installed' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderIntegrations() {
    const { default: IntegrationsCard } = await import(
      '@renderer/features/settings/components/IntegrationsCard'
    );
    await act(async () => root.render(createElement(IntegrationsCard)));
  }

  it('keeps model relay services out of the product integrations page', async () => {
    await renderIntegrations();

    expect(host.textContent).not.toContain('LiteLLM');
    expect(host.textContent).not.toContain('New API');
    expect(host.textContent).not.toContain('CLIProxyAPI');
    expect(host.textContent).toContain('GitHub');
    expect(host.textContent).toContain('Linear');
  });

  it('shows Lovcode and opens the download page when it is not installed', async () => {
    await renderIntegrations();

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
      .mockResolvedValueOnce({ status: 'available', version: 'lovcode 0.40.0' });
    await renderIntegrations();

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
    await renderIntegrations();

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
    await renderIntegrations();

    expect(host.textContent).toContain('settings.integrationsTab.lovcodeUpgradeDescription:0.39.9');
    const upgradeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.integrationsTab.upgrade:Lovcode"]'
    );
    expect(upgradeButton).not.toBeNull();
    await act(async () => upgradeButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(LOVCODE_DOWNLOAD_URL);
  });
});
