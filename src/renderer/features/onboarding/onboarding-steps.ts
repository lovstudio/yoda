export type OnboardingStep = 'language' | 'sign-in' | 'maas-gateway';

export function getOnboardingSteps({
  isSignedIn,
  isMaasGatewayInstalled,
}: {
  isSignedIn: boolean;
  isMaasGatewayInstalled: boolean;
}): OnboardingStep[] {
  const steps: OnboardingStep[] = ['language'];

  if (!isSignedIn) steps.push('sign-in');
  if (!isMaasGatewayInstalled) steps.push('maas-gateway');

  return steps;
}
