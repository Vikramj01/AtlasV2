import { useState } from 'react';
import type { Step1Data, WizardStep } from '@/types/strategy';
import { Step1Outcome } from './Step1Outcome';

export function StrategyWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);

  function handleStep1Complete(data: Step1Data) {
    setStep1Data(data);
    setStep(2);
  }

  const stepLabel =
    step === 1
      ? 'Step 1 of 2'
      : step === 2
        ? 'Step 2 of 2'
        : 'Your Strategy Brief';

  return (
    <div>
      <p className="mb-8 text-center text-sm text-muted-foreground">{stepLabel}</p>

      {step === 1 && <Step1Outcome onComplete={handleStep1Complete} />}

      {step === 2 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Outcome captured: {step1Data?.businessType}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Event evaluation — coming in Sprint 2.
          </p>
        </div>
      )}
    </div>
  );
}
