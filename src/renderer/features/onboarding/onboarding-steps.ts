export type OnboardingStep = 'language' | 'sign-in';

export function getOnboardingSteps({ isSignedIn }: { isSignedIn: boolean }): OnboardingStep[] {
  const steps: OnboardingStep[] = ['language'];

  if (!isSignedIn) steps.push('sign-in');

  return steps;
}
