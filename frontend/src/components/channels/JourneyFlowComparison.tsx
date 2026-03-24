/**
 * JourneyFlowComparison
 *
 * Side-by-side journey flow comparison across up to 3 channels.
 * Renders real funnel steps (Landing → Engagement → Micro-Conv → Conversion)
 * once sessions have been ingested and a compute run has completed.
 */

'use client';

import { useState } from 'react';
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

const CHANNEL_COLORS: Partial<Record<ChannelType, string>> = {
  google_ads:     'bg-blue-100 text-blue-700',
  meta_ads:       'bg-indigo-100 text-indigo-700',
  tiktok_ads:     'bg-pink-100 text-pink-700',
  linkedin_ads:   'bg-sky-100 text-sky-700',
  organic_search: 'bg-green-100 text-green-700',
  email:          'bg-orange-100 text-orange-700',
  direct:         'bg-slate-100 text-slate-700',
  referral:       'bg-purple-100 text-purple-700',
};

interface JourneyFlowComparisonProps {
  journeys: ChannelJourneyMap[];
}

export function JourneyFlowComparison({ journeys }: JourneyFlowComparisonProps) {
  const [pinnedChannels, setPinnedChannels] = useState<ChannelType[]>([]);

  if (journeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">Journey maps not yet computed</p>
          <p className="mt-1 text-xs text-muted-foreground/70 max-w-sm mx-auto">
            Once sessions are ingested via{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
              POST /api/channels/ingest
            </code>
            , use the Refresh button to compute journey maps.
          </p>
        </div>
      </div>
    );
  }

  // If the user has pinned specific channels use those, otherwise show the top 3 by sessions
  const displayJourneys =
    pinnedChannels.length > 0
      ? journeys.filter((j) => pinnedChannels.includes(j.channel))
      : journeys.slice(0, 3);

  const togglePin = (channel: ChannelType) => {
    setPinnedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : prev.length < 3
          ? [...prev, channel]
          : prev,
    );
  };

  const cols =
    displayJourneys.length === 1
      ? 'grid-cols-1 max-w-md'
      : displayJourneys.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* Channel picker */}
      {journeys.length > 3 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center">
            Compare channels:
          </span>
          {journeys.map((j) => {
            const active = pinnedChannels.includes(j.channel);
            const colorClass = CHANNEL_COLORS[j.channel] ?? 'bg-muted text-muted-foreground';
            return (
              <button
                key={j.channel}
                onClick={() => togglePin(j.channel)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-opacity ${colorClass} ${
                  active ? 'opacity-100 ring-2 ring-offset-1 ring-current' : 'opacity-60 hover:opacity-90'
                }`}
              >
                {CHANNEL_LABELS[j.channel] ?? j.channel}
              </button>
            );
          })}
          {pinnedChannels.length > 0 && (
            <button
              onClick={() => setPinnedChannels([])}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <div className={`grid gap-4 ${cols}`}>
        {displayJourneys.map((journey) => {
          const colorClass =
            CHANNEL_COLORS[journey.channel] ?? 'bg-muted text-muted-foreground';
          const hasSteps = journey.journey_steps.length > 0;

          return (
            <div key={journey.id} className="rounded-xl border bg-card p-4 space-y-3">
              {/* Channel header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
                  >
                    {CHANNEL_LABELS[journey.channel] ?? journey.channel}
                  </span>
                  <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{journey.total_sessions.toLocaleString()} sessions</span>
                    <span>{(journey.conversion_rate * 100).toFixed(1)}% conv.</span>
                    <span>SCS {(journey.signal_completion_score * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* Journey funnel steps */}
              <div className="pt-1">
                {hasSteps ? (
                  journey.journey_steps.map((step, i) => (
                    <JourneyStepCard
                      key={step.step_number}
                      step={step}
                      isLast={i === journey.journey_steps.length - 1}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground/60 italic py-2">
                    No events recorded yet for this channel.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
