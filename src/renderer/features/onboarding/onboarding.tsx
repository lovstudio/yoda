import { useState } from 'react';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { OnboardingShell } from './onboarding-shell';

type OnboardingStep = 'sign-in' | 'import';

export function Onboarding({
  steps: initialSteps,
  onComplete,
}: {
  steps: OnboardingStep[];
  onComplete: () => void;
}) {
  const [steps] = useState(initialSteps);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full [-webkit-app-region:drag]">
      <OnboardingShell steps={steps} onComplete={onComplete} />
      <ModalRenderer />
    </div>
  );
}
