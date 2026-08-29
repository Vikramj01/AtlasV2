import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStepDef {
  n: number;
  label: string;
}

interface Props {
  steps: WizardStepDef[];
  currentStep: number;
  className?: string;
}

/**
 * Multi-step wizard progress indicator — line-and-node style per DESIGN.md's
 * stepper spec: completed steps in console-green, the active step in
 * console-primary with a soft ring, everything else muted.
 */
export function WizardStepper({ steps, currentStep, className }: Props) {
  return (
    <nav className={cn('hidden items-center gap-0.5 md:flex', className)} aria-label="Wizard steps">
      {steps.map(({ n, label }) => {
        const isDone = n < currentStep;
        const isCurrent = n === currentStep;

        return (
          <div key={n} className="flex items-center gap-0.5">
            {/* Node */}
            <div
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold transition-colors',
                isDone
                  ? 'bg-console-green text-white'
                  : isCurrent
                    ? 'bg-console-primary text-white ring-2 ring-console-primary/25'
                    : 'bg-console-chip text-console-fg-disabled',
              )}
            >
              {isDone ? <Check className="h-3 w-3" strokeWidth={2.5} /> : n}
            </div>

            {/* Label */}
            <span
              className={cn(
                'font-heading text-xs',
                isCurrent
                  ? 'font-semibold text-console-primary'
                  : isDone
                    ? 'font-medium text-console-fg-muted'
                    : 'font-medium text-console-fg-disabled',
              )}
            >
              {label}
            </span>

            {/* Connector */}
            {n < steps.length && (
              <div
                className={cn(
                  'mx-1.5 h-px w-5 shrink-0 rounded-full transition-colors',
                  isDone ? 'bg-console-green' : 'bg-console-border',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
