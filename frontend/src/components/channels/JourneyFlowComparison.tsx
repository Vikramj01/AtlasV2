/**
 * JourneyFlowComparison — Phase 2
 *
 * Side-by-side journey flow comparison across channels.
 * Currently renders available journey maps. Full event-level step data
 * populates in Phase 2 once journeyComputation.ts is fully implemented.
 */

import { GitBranch } from 'lucide-react';
import { JourneyStepCard } from './JourneyStep';
import type { ChannelJourneyMap, ChannelType } from '@/types/channel';

const CHANNEL_LABELS: Record<ChannelType, string> = {
  google_ads:        'Google Ads',
  meta_ads:          'Meta Ads',
  tiktok_ads:        'TikTok Ads',
  linkedin_ads:      'LinkedIn Ads',
  organic_search:    'Organic Search',
  paid_search_other: 'Paid Search (Other)',
  organic_social:    'Organic Social',
  paid_social_other: 'Paid Social (Other)',
  email:             'Email',
  referral:          'Referral',
  direct:            'Direct',
  other:             'Other',
};

interface JourneyFlowComparisonProps {
  journeys: ChannelJourneyMap[];
}

export function JourneyFlowComparison({ journeys }: JourneyFlowComparisonProps) {
  if (journeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">Journey maps not yet computed</p>
          <p className="mt-1 text-xs text-muted-foreground/70 max-w-sm mx-auto">
            Once sessions are ingested via <code className="bg-muted px-1 py-0.5 rounded text-[11px]">POST /api/channels/ingest</code>,
            trigger a compute run to generate journey maps.
          </p>
        </div>
      </div>
    );
  }

  // Show up to 3 channels side by side
  const displayJourneys = journeys.slice(0, 3);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Showing top {displayJourneys.length} channels by session volume. Full event-level step data arrives in Phase 2.
      </p>
      <div className={`grid gap-4 ${displayJourneys.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} ${displayJourneys.length === 3 ? 'lg:grid-cols-3' : ''}`}>
        {displayJourneys.map((journey) => (
          <div key={journey.id} className="rounded-xl border bg-card p-4 space-y-3">
            {/* Channel header */}
            <div>
              <h3 className="text-sm font-semibold">
                {CHANNEL_LABELS[journey.channel] ?? journey.channel}
              </h3>
              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                <span>{journey.total_sessions.toLocaleString()} sessions</span>
                <span>{(journey.conversion_rate * 100).toFixed(1)}% conv.</span>
                <span>SCS {(journey.signal_completion_score * 100).toFixed(0)}%</span>
              </div>
            </div>

            {/* Journey steps */}
            <div className="pt-1">
              {journey.journey_steps.length > 0 ? (
                journey.journey_steps.map((step, i) => (
                  <JourneyStepCard
                    key={step.step_number}
                    step={step}
                    isLast={i === journey.journey_steps.length - 1}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground/60 italic py-2">
                  No step data yet — full journey steps computed in Phase 2.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
