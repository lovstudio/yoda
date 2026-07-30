import { describe, expect, it } from 'vitest';
import { getOnboardingSteps } from './onboarding-steps';

describe('getOnboardingSteps', () => {
  it('always starts first-run setup with language selection', () => {
    expect(
      getOnboardingSteps({
        isSignedIn: false,
        isMaasGatewayInstalled: false,
      })
    ).toEqual(['language', 'sign-in', 'maas-gateway']);
  });

  it('keeps language selection when account and gateway setup are already complete', () => {
    expect(
      getOnboardingSteps({
        isSignedIn: true,
        isMaasGatewayInstalled: true,
      })
    ).toEqual(['language']);
  });
});
