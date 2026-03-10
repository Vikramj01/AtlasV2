import { cn } from '@/lib/utils';

type OverallStatus = 'healthy' | 'partially_broken' | 'critical';

const CONFIG: Record<OverallStatus, { icon: string; headline: string; bg: string; border: string; text: string }> = {
  healthy: {
    icon: '🟢',
    headline: 'Your Conversion Signals Are Healthy',
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
  },
  partially_broken: {
    icon: '🟡',
    headline: 'Your Signals Are Partially Broken',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
  },
  critical: {
    icon: '🔴',
    headline: 'Critical Attribution Issues Detected',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
  },
};

interface Props {
  status: OverallStatus;
  summary: string;
}

export function StatusBanner({ status, summary }: Props) {
  const c = CONFIG[status];
  return (
    <div className={cn('rounded-xl border-2 px-6 py-5', c.border, c.bg)}>
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">{c.icon}</span>
        <h2 className={cn('text-xl font-bold', c.text)}>{c.headline}</h2>
      </div>
      <p className="mt-2 text-sm text-gray-700 leading-relaxed">{summary}</p>
    </div>
  );
}
