import { cn } from '@/lib/utils';
import { STATUS_LABELS } from '@/lib/ui-copy';

interface Props {
  score: number;
}

export function HealthBadge({ score }: Props) {
  const { className, statusKey } =
    score >= 80
      ? { className: 'bg-green-100 text-green-700 border-green-200', statusKey: 'healthy' as const }
      : score >= 60
      ? { className: 'bg-yellow-100 text-yellow-700 border-yellow-200', statusKey: 'warning' as const }
      : { className: 'bg-red-100 text-red-700 border-red-200', statusKey: 'error' as const };

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold', className)}>
      {score}
      <span className="text-xs font-normal opacity-70">{STATUS_LABELS[statusKey].badge}</span>
    </span>
  );
}
