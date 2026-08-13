export type OnboardingStep = 'language' | 'claude-retention' | 'sign-in';

export function getOnboardingSteps({ isSignedIn }: { isSignedIn: boolean }): OnboardingStep[] {
  const steps: OnboardingStep[] = ['language', 'claude-retention'];

  if (!isSignedIn) steps.push('sign-in');

  return steps;
}
