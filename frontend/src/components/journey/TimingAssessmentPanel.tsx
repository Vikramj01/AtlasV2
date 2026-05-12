import type { ReactNode } from 'react';
import type { LagClass } from '@/types/journey';
import { TimingBadge } from './TimingBadge';
import { PlatformStatusRow } from './PlatformStatusRow';
import { getRiskSummary } from '@/lib/journey/classifyEvent';

interface TimingAssessmentPanelProps {
  eventName: string;
  lagClass: LagClass;
  // Slot for Sprint 3 proxy recommendations — rendered below the platform rows
  // when timing_risk is not 'none'. Pass null until Sprint 3 is wired up.
  proxySlot?: ReactNode;
}

export function TimingAssessmentPanel({
  eventName,
  lagClass,
  proxySlot,
}: TimingAssessmentPanelProps) {
  const isOptimal = lagClass === 'immediate';

  const borderColor = isOptimal
    ? 'border-green-200'
    : lagClass === 'short_lag'
      ? 'border-amber-200'
      : 'border-red-200';

  const bgColor = isOptimal
    ? 'bg-green-50'
    : lagClass === 'short_lag'
      ? 'bg-amber-50'
      : 'bg-red-50';

  return (
    <div className={`mt-3 rounded-lg border ${borderColor} ${bgColor} p-3 space-y-2`}>
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-foreground">⏱ Signal Timing</span>
        <TimingBadge lagClass={lagClass} />
      </div>

      {/* Event name + risk summary */}
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-foreground">{eventName}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {getRiskSummary(lagClass, eventName)}
        </p>
      </div>

      {/* Platform breakdown */}
      <div className="space-y-1.5 pt-1 border-t border-black/5">
        <PlatformStatusRow platform="meta" lagClass={lagClass} />
        <PlatformStatusRow platform="google" lagClass={lagClass} />
      </div>

      {/* Proxy recommendations slot (Sprint 3) */}
      {!isOptimal && proxySlot && (
        <div className="pt-1 border-t border-black/5">
          {proxySlot}
        </div>
      )}

      {/* Placeholder shown until Sprint 3 wires in real recommendations */}
      {!isOptimal && !proxySlot && (
        <div className="pt-1 border-t border-black/5">
          <p className="text-[11px] text-muted-foreground italic">
            → Proxy event recommendations coming in next step.
          </p>
        </div>
      )}
    </div>
  );
}
