import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@renderer/utils/utils';
import { LanguageStep } from './language-step';
import type { OnboardingStep } from './onboarding-steps';
import { SignInStep } from './sign-in-step';

const stepConfig: Record<
  OnboardingStep,
  { labelKey: string; component: React.ComponentType<{ onComplete: () => void }> }
> = {
  language: {
    labelKey: 'onboarding.language.stepTitle',
    component: LanguageStep,
  },
  'sign-in': {
    labelKey: 'onboarding.signInTitle',
    component: SignInStep,
  },
};

function StepHeader({
  label,
  isActive,
  isLast,
}: {
  label: string;
  isActive: boolean;
  isLast: boolean;
}) {
  return (
    <div
      aria-current={isActive ? 'step' : undefined}
      className={cn(
        'text-md border-r px-5 py-3',
        isActive ? 'bg-background-1 text-primary' : 'text-foreground-muted',
        isLast && 'border-r-0'
      )}
    >
      {label}
    </div>
  );
}

export function OnboardingShell({
  steps,
  onComplete,
}: {
  steps: OnboardingStep[];
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStep = steps[activeIndex];
  const StepComponent = stepConfig[activeStep]?.component;

  const handleStepComplete = () => {
    const nextIndex = activeIndex + 1;
    if (nextIndex >= steps.length) {
      onComplete();
    } else {
      setActiveIndex(nextIndex);
    }
  };

  return (
    <div className="@container flex h-full max-h-[70vh] min-h-0 w-full max-w-5xl flex-col items-start justify-center mx-auto [-webkit-app-region:no-drag]">
      <div className="flex max-w-full flex-row overflow-hidden border border-b-0">
        {steps.map((step, index) => (
          <StepHeader
            key={step}
            label={t(stepConfig[step].labelKey)}
            isLast={index === steps.length - 1}
            isActive={step === activeStep}
          />
        ))}
      </div>
      <div className="flex min-h-0 flex-col items-center justify-center h-full w-full border bg-background-1">
        <StepComponent onComplete={handleStepComplete} />
      </div>
    </div>
  );
}
