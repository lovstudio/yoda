import { describe, expect, it } from 'vitest';
import { getOnboardingSteps } from './onboarding-steps';

describe('getOnboardingSteps', () => {
  it('always starts first-run setup with language selection', () => {
    expect(
      getOnboardingSteps({
        isSignedIn: false,
      })
    ).toEqual(['language', 'claude-retention', 'sign-in']);
  });

  it('keeps language selection when account setup is already complete', () => {
    expect(
      getOnboardingSteps({
        isSignedIn: true,
      })
    ).toEqual(['language', 'claude-retention']);
  });
});
