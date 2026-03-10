import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ReportJSON, JourneyStage, RuleStatus } from '@/types/audit';

const STATUS_CONFIG: Record<RuleStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  pass:    { color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-300',  dot: 'bg-green-500',  label: 'Healthy' },
  warning: { color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-300', dot: 'bg-yellow-400', label: 'Warning' },
  fail:    { color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-300',    dot: 'bg-red-500',    label: 'Critical' },
};

function StageNode({
  stage,
  active,
  onClick,
  isLast,
}: {
  stage: JourneyStage;
  active: boolean;
  onClick: () => void;
  isLast: boolean;
}) {
  const c = STATUS_CONFIG[stage.status];
  return (
    <div className="flex items-center">
      <button
        onClick={onClick}
        className="flex flex-col items-center gap-1.5 transition-transform hover:scale-105 focus:outline-none group"
      >
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-sm transition-all',
            c.bg,
            active ? `${c.border} ring-2 ring-offset-2 ring-brand-400` : c.border
          )}
        >
          <span className={cn('h-4 w-4 rounded-full', c.dot)} />
        </div>
        <span className="text-xs font-medium text-center w-16 leading-tight group-hover:text-foreground text-muted-foreground">
          {stage.stage}
        </span>
        <span className={cn('text-xs font-semibold', c.color)}>{c.label}</span>
      </button>
      {!isLast && (
        <div className="mx-1 h-0.5 w-8 shrink-0 bg-border sm:w-12" aria-hidden="true" />
      )}
    </div>
  );
}

function StagePanel({ stage, onClose }: { stage: JourneyStage; onClose: () => void }) {
  const c = STATUS_CONFIG[stage.status];
  return (
    <div className={cn('rounded-xl border-2 p-5 transition-all', c.border, c.bg)}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className={cn('font-semibold', c.color)}>{stage.stage} Stage</h3>
          <span className={cn('mt-0.5 text-xs font-medium', c.color)}>{c.label}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 text-muted-foreground">
          ×
        </Button>
      </div>

      {stage.issues.length === 0 ? (
        <p className="mt-3 text-sm text-green-700">No issues detected at this stage.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stage.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-0.5 shrink-0 text-red-500" aria-hidden="true">✖</span>
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  report: ReportJSON;
}

export function JourneyBreakdown({ report }: Props) {
  const [activeStage, setActiveStage] = useState<JourneyStage | null>(null);
  const { journey_stages } = report;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Conversion Journey</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Click any stage to see what's happening — and what to fix.
        </p>
      </div>

      {/* Desktop: horizontal funnel */}
      <Card>
        <CardContent className="p-6 overflow-x-auto">
          <div className="flex items-start justify-start gap-0 min-w-max">
            {journey_stages.map((stage, i) => (
              <StageNode
                key={stage.stage}
                stage={stage}
                active={activeStage?.stage === stage.stage}
                onClick={() => setActiveStage(activeStage?.stage === stage.stage ? null : stage)}
                isLast={i === journey_stages.length - 1}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mobile: vertical stepper */}
      <div className="flex flex-col gap-3 sm:hidden">
        {journey_stages.map((stage) => {
          const c = STATUS_CONFIG[stage.status];
          return (
            <button
              key={stage.stage}
              onClick={() => setActiveStage(activeStage?.stage === stage.stage ? null : stage)}
              className={cn('flex items-center gap-3 rounded-xl border-2 p-4 text-left', c.bg, c.border)}
            >
              <span className={cn('h-3 w-3 rounded-full shrink-0', c.dot)} />
              <span className="font-medium text-sm">{stage.stage}</span>
              <span className={cn('ml-auto text-xs font-semibold', c.color)}>{c.label}</span>
            </button>
          );
        })}
      </div>

      {activeStage && (
        <StagePanel stage={activeStage} onClose={() => setActiveStage(null)} />
      )}
    </div>
  );
}
