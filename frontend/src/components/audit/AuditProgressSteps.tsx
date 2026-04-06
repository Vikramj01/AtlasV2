/**
 * AuditProgressSteps — vertical checklist during an in-flight audit.
 *
 * Design spec:
 *   Completed: green fill (#059669) + checkmark.
 *   Active: navy border + light navy bg (#EEF1F7).
 *   Upcoming: gray border, muted text.
 */

import { Check } from 'lucide-react';
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

const NAVY  = '#1B2A4A';
const GREEN = '#059669';

export function AuditProgressSteps({ progress }: Props) {
  const completedSteps = Math.floor((progress / 100) * STEPS.length);

  return (
    <div className="space-y-3">
      {STEPS.map((step, i) => {
        const done   = i < completedSteps;
        const active = i === completedSteps;
        return (
          <div key={step} className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                done
                  ? 'text-white'
                  : active
                  ? 'border-2 text-white'
                  : 'border-2 bg-white text-[#9CA3AF]',
              )}
              style={
                done
                  ? { backgroundColor: GREEN }
                  : active
                  ? { backgroundColor: '#EEF1F7', borderColor: NAVY, color: NAVY }
                  : { borderColor: '#E5E7EB' }
              }
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
            </div>
            <span
              className={cn('text-sm transition-colors', done ? 'text-[#9CA3AF] line-through' : active ? 'font-medium text-[#1A1A1A]' : 'text-[#9CA3AF]')}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
