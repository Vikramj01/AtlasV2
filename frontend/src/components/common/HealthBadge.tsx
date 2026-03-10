import { cn } from '@/lib/utils';

interface Props {
  score: number;
}

export function HealthBadge({ score }: Props) {
  const { className, label } =
    score >= 80
      ? { className: 'bg-green-100 text-green-700 border-green-200', label: 'Healthy' }
      : score >= 60
      ? { className: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'At Risk' }
      : { className: 'bg-red-100 text-red-700 border-red-200', label: 'Critical' };

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold', className)}>
      {score}
      <span className="text-xs font-normal opacity-70">{label}</span>
    </span>
  );
}
