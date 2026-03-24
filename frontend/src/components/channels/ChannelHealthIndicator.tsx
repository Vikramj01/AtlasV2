import type { HealthStatus } from '@/types/channel';

interface ChannelHealthIndicatorProps {
  status: HealthStatus;
  score: number;
  showLabel?: boolean;
}

const STATUS_CONFIG = {
  healthy: {
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700',
    label: 'Healthy',
  },
  warning: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Warning',
  },
  critical: {
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700',
    label: 'Critical',
  },
};

export function ChannelHealthIndicator({
  status,
  score,
  showLabel = true,
}: ChannelHealthIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${config.dot}`} />
      {showLabel ? (
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${config.badge}`}>
          {config.label}
        </span>
      ) : (
        <span className="text-xs font-semibold tabular-nums">
          {(score * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}
