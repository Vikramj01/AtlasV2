import type { JourneyStep as JourneyStepType } from '@/types/channel';

const HEALTH_CONFIG = {
  healthy: { dot: 'bg-green-500', label: 'Healthy' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded' },
  missing: { dot: 'bg-red-500', label: 'Missing' },
  mixed: { dot: 'bg-gray-400', label: 'Mixed' },
};

interface JourneyStepProps {
  step: JourneyStepType;
  isLast?: boolean;
}

export function JourneyStepCard({ step, isLast = false }: JourneyStepProps) {
  const health = HEALTH_CONFIG[step.signal_health];

  return (
    <div className="flex gap-3">
      {/* Connector */}
      <div className="flex flex-col items-center shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5 text-xs font-bold text-primary">
          {step.step_number}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className={`pb-4 flex-1 ${isLast ? '' : ''}`}>
        <div className="rounded-lg border bg-card px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground truncate">
              {step.type === 'page_view' ? '📄' : '⚡'} {step.identifier}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
              <span className="text-[10px] text-muted-foreground">{health.label}</span>
            </div>
          </div>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <span>{step.session_count.toLocaleString()} sessions</span>
            <span>{step.percentage.toFixed(0)}% reached</span>
            {step.drop_off_rate > 0 && (
              <span className="text-red-500">−{step.drop_off_rate.toFixed(0)}% drop-off</span>
            )}
          </div>
          {step.signal_health_detail && (
            <p className="text-[11px] text-muted-foreground/70 italic">{step.signal_health_detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
