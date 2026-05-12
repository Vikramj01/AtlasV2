import { cn } from '@/lib/utils';
import type { JourneyDuration } from '@/types/journey';
import { JOURNEY_DURATION_OPTIONS } from '@/types/journey';

interface BusinessModelContextSelectorProps {
  value: JourneyDuration | null;
  onChange: (duration: JourneyDuration) => void;
}

export function BusinessModelContextSelector({ value, onChange }: BusinessModelContextSelectorProps) {
  return (
    <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-muted/30 p-3">
      <p className="text-xs font-medium text-foreground mb-2">
        How long does it typically take from first ad click to this conversion?
      </p>
      <div className="space-y-1.5">
        {JOURNEY_DURATION_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex items-center gap-2.5 cursor-pointer rounded-md px-2.5 py-1.5 text-xs transition-colors',
                selected
                  ? 'bg-[#EEF1F7] text-[#1B2A4A] font-medium'
                  : 'hover:bg-muted/60 text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name={`journey-duration-${option.value}`}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="accent-[#1B2A4A] flex-shrink-0"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
