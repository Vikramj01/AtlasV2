import { cn } from '@/lib/utils';

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface MultiChipToggleProps<T extends string> {
  options: ChipOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  className?: string;
}

/** A row of toggleable chip buttons for a small multi-select (declared platforms, traffic regions). */
export function MultiChipToggle<T extends string>({ options, selected, onChange, className }: MultiChipToggleProps<T>) {
  const toggle = (value: T) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-input bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
