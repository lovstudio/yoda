import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile Relay account recovery interaction', () => {
  it('opens LovStudio sign-in and continues enabling Relay after authentication', () => {
    const source = readFileSync(
      new URL('../renderer/features/mobile/mobile-view.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("useShowModal('accountDeviceFlowModal')");
    expect(source).toContain('await signIn.mutateAsync(undefined)');
    expect(source).toContain('await rpc.mobileGateway.enableRelay()');
    expect(source).toContain("t('sidebar.mobileConnection.signInToEnableRelay')");
    expect(source).toContain("/^Error invoking remote method '[^']+':");
  });

  it('invalidates renderer account and Relay snapshots when main expires the session', () => {
    const source = readFileSync(
      new URL('../renderer/app/account-session-events.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain('events.on(accountSessionChangedChannel');
    expect(source).toContain('ACCOUNT_SESSION_KEY');
    expect(source).toContain("['mobileGateway', 'relayStatus']");
  });
});
