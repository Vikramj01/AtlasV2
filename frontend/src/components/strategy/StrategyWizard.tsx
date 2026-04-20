import { useState } from 'react';
import type { Step1Data, Step2Data, StrategyBrief, WizardStep } from '@/types/strategy';
import { evaluateStrategy, strategyApi } from '@/lib/api/strategyApi';
import { Step1Outcome } from './Step1Outcome';
import { Step2EventEval } from './Step2EventEval';
import { StrategyBrief as StrategyBriefScreen } from './StrategyBrief';

const VERDICT_MAP: Record<string, 'keep' | 'add_proxy' | 'switch'> = {
  CONFIRM: 'keep',
  AUGMENT: 'add_proxy',
  REPLACE: 'switch',
};

export function StrategyWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);
  const [brief, setBrief] = useState<StrategyBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStep1Complete(data: Step1Data) {
    setStep1Data(data);
    setError(null);
    setStep(2);
  }

  async function handleStep2Submit(step2Data: Step2Data) {
    if (!step1Data) return;
    setLoading(true);
    setError(null);
    try {
      const result = await evaluateStrategy({
        businessType: step1Data.businessType,
        outcomeDescription: step1Data.outcomeDescription,
        outcomeTimingDays: step1Data.outcomeTimingDays,
        currentEventName: step2Data.currentEventName,
        eventSource: step2Data.eventSource,
        valueDataPresent: step2Data.valueDataPresent,
      });

      // Persist brief to Supabase (non-blocking — gate check on subsequent actions)
      strategyApi.saveBrief({
        business_outcome: step1Data.outcomeDescription,
        outcome_timing_days: step1Data.outcomeTimingDays,
        current_event: step2Data.currentEventName,
        verdict: VERDICT_MAP[result.eventVerdict] ?? 'keep',
        proxy_event: result.proxyEventName ?? undefined,
        rationale: result.verdictRationale,
      }).catch(() => { /* non-blocking */ });

      setBrief(result);
      setStep('output');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong evaluating your event. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setError(null);
    setStep(1);
  }

  function handleReset() {
    setStep(1);
    setStep1Data(null);
    setBrief(null);
    setError(null);
    setLoading(false);
  }

  const stepLabel =
    step === 1 ? 'Step 1 of 2' : step === 2 ? 'Step 2 of 2' : 'Your Strategy Brief';

  return (
    <div>
      <p className="mb-8 text-center text-sm text-muted-foreground">{stepLabel}</p>

      {step === 1 && <Step1Outcome onComplete={handleStep1Complete} />}

      {step === 2 && (
        <Step2EventEval
          onSubmit={handleStep2Submit}
          onBack={handleBack}
          loading={loading}
          error={error}
        />
      )}

      {step === 'output' && brief && (
        <StrategyBriefScreen brief={brief} onReset={handleReset} />
      )}
    </div>
  );
}
