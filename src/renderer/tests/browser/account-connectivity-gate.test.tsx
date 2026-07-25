import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  session: {
    user: null,
    isSignedIn: false,
    hasAccount: false,
  },
  signIn: vi.fn(async () => ({ success: false, error: 'connection failed' })),
  showDeviceFlow: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/hooks/useAccount', () => ({
  useAccountSession: () => ({ data: mocks.session, isLoading: false }),
  useAccountHealth: () => ({ data: false }),
  useAccountSignIn: () => ({ mutateAsync: mocks.signIn, isPending: false }),
  useAccountSignOut: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAccountAuthWarmUp: vi.fn(),
  useAccountCommerce: vi.fn(),
  useAccountUpdateNickname: vi.fn(),
  useActivateRelayPass: vi.fn(),
  useRevokeRelayDevice: vi.fn(),
  useStartRelayTrial: vi.fn(),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: (id: string) => (id === 'accountDeviceFlowModal' ? mocks.showDeviceFlow : vi.fn()),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: vi.fn() } },
}));

describe('LovStudio account connectivity', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = {
      user: null,
      isSignedIn: false,
      hasAccount: false,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the connect action available when the advisory health check fails', async () => {
    const { AccountTab } = await import('@renderer/features/settings/components/AccountTab');
    await act(async () => root.render(createElement(AccountTab)));

    expect(host.textContent).toContain('settings.serverUnavailable');
    const connectButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.account.createAccount')
    );
    expect(connectButton).toBeDefined();

    await act(async () => connectButton?.click());

    expect(mocks.showDeviceFlow).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledWith(undefined);
  });

  it('keeps reconnect available for an expired local session', async () => {
    mocks.session = {
      user: null,
      isSignedIn: false,
      hasAccount: true,
    };
    const { AccountTab } = await import('@renderer/features/settings/components/AccountTab');
    await act(async () => root.render(createElement(AccountTab)));

    expect(host.textContent).toContain('settings.serverUnavailable');
    expect(host.textContent).toContain('settings.account.signIn');
  });
});
