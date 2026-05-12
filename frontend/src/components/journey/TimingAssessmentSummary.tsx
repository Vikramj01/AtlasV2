import { useState } from 'react';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { CONVERSION_ACTION_KEYS, ACTION_TOGGLES } from '@/types/journey';
import { TimingBadge } from './TimingBadge';
import { ProxyRecommendationList } from './ProxyRecommendationList';

// Collects every stageId::actionKey entry from stageTiming that belongs to
// a conversion action that is currently toggled on in its stage.
interface AssessedEvent {
  stageId: string;
  stageLabel: string;
  actionKey: string;
  actionLabel: string;
  timingKey: string;
}

export function TimingAssessmentSummary() {
  const { stages, stageTiming } = useJourneyWizardStore();
  const [expanded, setExpanded] = useState(false);

  // Build the list of assessed conversion events
  const assessed: AssessedEvent[] = [];
  for (const stage of stages) {
    if (stageTiming[stage.id]?.is_proxy) continue; // skip proxy stages themselves
    for (const actionKey of stage.actions) {
      if (!CONVERSION_ACTION_KEYS.has(actionKey)) continue;
      const timingKey = `${stage.id}::${actionKey}`;
      if (!stageTiming[timingKey]) continue; // user hasn't chosen a duration yet
      const toggle = ACTION_TOGGLES.find((t) => t.key === actionKey);
      assessed.push({
        stageId: stage.id,
        stageLabel: stage.label,
        actionKey,
        actionLabel: toggle?.label ?? actionKey,
        timingKey,
      });
    }
  }

  // Only render when 2+ events have been assessed
  if (assessed.length < 2) return null;

  const flagged = assessed.filter((e) => {
    const risk = stageTiming[e.timingKey]?.timing_risk;
    return risk && risk !== 'none';
  });

  return (
    <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Signal Timing Summary</p>
        {flagged.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {flagged.length} event{flagged.length > 1 ? 's' : ''} need proxy signals
          </span>
        )}
      </div>

      {/* One row per assessed event */}
      <div className="divide-y divide-[#F3F4F6]">
        {assessed.map((e) => {
          const timing = stageTiming[e.timingKey];
          if (!timing) return null;
          return (
            <div key={e.timingKey} className="flex items-center gap-2 py-1.5">
              <span className="flex-1 min-w-0 text-xs text-foreground truncate">
                <span className="text-muted-foreground">{e.stageLabel} — </span>
                {e.actionLabel}
              </span>
              <TimingBadge lagClass={timing.lag_class} />
            </div>
          );
        })}
      </div>

      {/* Review Recommendations expander — only when there are flagged events */}
      {flagged.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-[#1B2A4A] hover:text-[#1B2A4A]/80 flex items-center gap-1"
          >
            <span>{expanded ? '▲' : '▼'}</span>
            <span>{expanded ? 'Hide recommendations' : 'Review Recommendations'}</span>
          </button>

          {expanded && (
            <div className="mt-3 space-y-4">
              {flagged.map((e) => {
                const timing = stageTiming[e.timingKey];
                if (!timing) return null;
                return (
                  <div key={e.timingKey} className="space-y-2">
                    <p className="text-xs font-medium text-foreground">
                      {e.stageLabel} — {e.actionLabel}
                    </p>
                    <ProxyRecommendationList
                      lagClass={timing.lag_class}
                      parentStageId={e.stageId}
                      parentDuration={timing.journey_duration}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
