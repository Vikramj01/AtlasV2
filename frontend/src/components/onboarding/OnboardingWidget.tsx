import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { useOnboardingStore } from '@/store/onboardingStore';
import type { OnboardingStep } from '@/types/onboarding';
import { cn } from '@/lib/utils';

const STEP_TITLES: Record<string, string> = {
  '1.1': 'Set naming conventions',
  '1.2': 'Review event taxonomy',
  '1.3': 'Choose a starter signal pack',
  '1.4': 'Invite your team',
  '2.1': 'Add your first client',
  '2.2': 'Connect platforms',
  '2.3': 'Design your tagging',
  '2.4': 'Generate deliverables',
  '2.5': 'Verify your implementation',
};

// Small SVG progress ring
function ProgressRing({ progress }: { progress: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" className="shrink-0">
      <circle cx="13" cy="13" r={r} fill="none" stroke="#E5E7EB" strokeWidth="3" />
      <circle
        cx="13" cy="13" r={r}
        fill="none"
        stroke={progress === 100 ? '#22C55E' : '#1B2A4A'}
        strokeWidth="3"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 13 13)"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
    </svg>
  );
}

export function OnboardingWidget() {
  const { status, completedCount, totalSteps, overallProgress } = useOnboardingStore();
  const [open, setOpen] = useState(false);

  if (!status) return null;

  const steps = (Object.entries(status.steps) as [string, OnboardingStep][]).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o: boolean) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:border-foreground/20 transition-colors"
        aria-label="Toggle setup guide"
      >
        <ProgressRing progress={overallProgress} />
        <span>Setup: {completedCount}/{totalSteps}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-border bg-white shadow-lg">
          <div className="p-3 border-b border-border">
            <p className="text-xs font-semibold text-foreground">{completedCount} of {totalSteps} steps complete</p>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {steps.map(([id, step]) => (
              <li
                key={id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs',
                  step.status === 'complete' && 'text-muted-foreground',
                  step.status === 'incomplete' && 'text-foreground',
                  step.status === 'skipped' && 'text-muted-foreground opacity-60',
                )}
              >
                <CheckCircle2
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    step.status === 'complete' ? 'text-green-500' : 'text-muted-foreground/30',
                  )}
                />
                <span className={step.status === 'complete' ? 'line-through' : ''}>
                  {STEP_TITLES[id]}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-2.5">
            <Link
              to="/getting-started"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-primary hover:underline"
            >
              Open full setup guide
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
