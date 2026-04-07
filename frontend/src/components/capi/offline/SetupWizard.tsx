/**
 * Offline Conversions Setup Wizard — 5-step container
 *
 * Full-page card wizard following the same pattern as the CAPI SetupWizard.
 * All wizard state lives in offlineConversionsStore (wizardDraft, wizardStep).
 * Steps are responsible for their own local form state and call
 * setWizardDraft() before invoking onNext.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import { Step1VerifyConnection } from './steps/Step1VerifyConnection';
import { Step2SelectAction } from './steps/Step2SelectAction';
import { Step3MapColumns } from './steps/Step3MapColumns';
import { Step4SetDefaults } from './steps/Step4SetDefaults';
import { Step5Confirm } from './steps/Step5Confirm';

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS: Array<{ number: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { number: 1, label: 'Connect' },
  { number: 2, label: 'Action' },
  { number: 3, label: 'Columns' },
  { number: 4, label: 'Defaults' },
  { number: 5, label: 'Confirm' },
];

function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, index) => {
        const done = step.number < current;
        const active = step.number === current;
        return (
          <div key={step.number} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                    ? 'border-2 border-primary bg-background text-primary'
                    : 'border-2 border-muted bg-background text-muted-foreground',
                ].join(' ')}
              >
                {done ? '✓' : step.number}
              </div>
              <span
                className={[
                  'mt-1 text-xs',
                  active ? 'font-semibold text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={[
                  'mb-5 h-0.5 w-10',
                  step.number < current ? 'bg-primary' : 'bg-muted',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step titles ───────────────────────────────────────────────────────────────

const STEP_TITLES: Record<number, string> = {
  1: 'Verify Google Ads connection',
  2: 'Select conversion action',
  3: 'Map CSV columns',
  4: 'Set defaults',
  5: 'Confirm & download template',
};

// ── Wizard container ───────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

export function OfflineSetupWizard({ onComplete, onCancel }: Props) {
  const {
    wizardStep,
    setWizardStep,
    wizardSaving,
    wizardError,
  } = useOfflineConversionsStore();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Set up offline conversions</h1>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={wizardSaving}>
          Cancel
        </Button>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator current={wizardStep} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{STEP_TITLES[wizardStep]}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* Global error banner */}
          {wizardError && wizardStep !== 5 && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {wizardError}
            </div>
          )}

          {wizardStep === 1 && (
            <Step1VerifyConnection onNext={() => setWizardStep(2)} />
          )}
          {wizardStep === 2 && (
            <Step2SelectAction
              onNext={() => setWizardStep(3)}
              onBack={() => setWizardStep(1)}
            />
          )}
          {wizardStep === 3 && (
            <Step3MapColumns
              onNext={() => setWizardStep(4)}
              onBack={() => setWizardStep(2)}
            />
          )}
          {wizardStep === 4 && (
            <Step4SetDefaults
              onNext={() => setWizardStep(5)}
              onBack={() => setWizardStep(3)}
            />
          )}
          {wizardStep === 5 && (
            <Step5Confirm
              onComplete={onComplete}
              onBack={() => setWizardStep(4)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
