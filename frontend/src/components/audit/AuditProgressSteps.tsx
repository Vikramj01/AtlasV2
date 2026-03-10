import { cn } from '@/lib/utils';

const STEPS = [
  'Launching browser',
  'Testing landing page',
  'Checking click ID persistence',
  'Validating purchase event',
  'Verifying platform delivery',
];

interface Props {
  progress: number; // 0–100
}

export function AuditProgressSteps({ progress }: Props) {
  // Map progress 0–100 to completed step count (0–5)
  const completedSteps = Math.floor((progress / 100) * STEPS.length);

  return (
    <div className="space-y-3">
      {STEPS.map((step, i) => {
        const done = i < completedSteps;
        const active = i === completedSteps;
        return (
          <div key={step} className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                done
                  ? 'bg-green-500 text-white'
                  : active
                  ? 'border-2 border-brand-500 bg-brand-50 text-brand-600'
                  : 'border-2 border-border bg-background text-muted-foreground'
              )}
            >
              {done ? '✓' : i + 1}
            </div>
            <span
              className={cn(
                'text-sm',
                done ? 'text-muted-foreground line-through' : active ? 'font-medium' : 'text-muted-foreground/60'
              )}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
