/**
 * WizardProgress — 4-step journey wizard stepper.
 *
 * Design spec:
 *   Completed steps: green fill (#059669) + checkmark, green connector.
 *   Current step: navy fill (#1B2A4A) + step number.
 *   Upcoming: light gray bg, muted text.
 *   Labels: 12px, current = navy, others = muted.
 */

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4;
}

const STEPS = [
  { number: 1, label: 'Business Type' },
  { number: 2, label: 'Journey Stages' },
  { number: 3, label: 'Platforms' },
  { number: 4, label: 'Review & Generate' },
];

const NAVY  = '#1B2A4A';
const GREEN = '#059669';

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, i) => {
        const isDone    = step.number < currentStep;
        const isCurrent = step.number === currentStep;

        return (
          <div key={step.number} className="flex items-center">
            <div className="flex flex-col items-center">
              {/* Step circle */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: isDone ? GREEN : isCurrent ? NAVY : '#F3F4F6',
                  color: isDone || isCurrent ? '#fff' : '#9CA3AF',
                }}
              >
                {isDone
                  ? <Check className="h-4 w-4" strokeWidth={2.5} />
                  : <span className="text-sm font-semibold">{step.number}</span>
                }
              </div>

              {/* Label */}
              <span
                className={cn('mt-1.5 text-xs font-medium', isCurrent ? 'font-semibold' : '')}
                style={{ color: isCurrent ? NAVY : isDone ? '#6B7280' : '#9CA3AF' }}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className="w-16 h-0.5 mx-2 mb-5 rounded-full transition-colors"
                style={{ backgroundColor: isDone ? GREEN : '#E5E7EB' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
