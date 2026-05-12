import { cn } from '@/lib/utils';
import type { LagClass } from '@/types/journey';
import { getTimingBadgeConfig } from '@/lib/journey/classifyEvent';

interface TimingBadgeProps {
  lagClass: LagClass;
  className?: string;
}

export function TimingBadge({ lagClass, className }: TimingBadgeProps) {
  const { label, colorClass } = getTimingBadgeConfig(lagClass);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        colorClass,
        className,
      )}
    >
      {label}
    </span>
  );
}
