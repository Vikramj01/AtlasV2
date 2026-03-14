import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;          // 0–100
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium">{clamped}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            clamped === 100 ? 'bg-green-500' : 'bg-brand-500',
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
