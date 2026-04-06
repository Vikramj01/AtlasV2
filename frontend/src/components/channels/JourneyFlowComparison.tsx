/**
 * JourneyFlowComparison
 *
 * Side-by-side journey flow comparison across up to 3 channels.
 * Channel picker pills use the design system navy selected state.
 */

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

// Subtle channel identity colors (same as ChannelOverviewTable)
const CHANNEL_STYLES: Partial<Record<ChannelType, { bg: string; color: string }>> = {
  google_ads:     { bg: '#DBEAFE', color: '#1D4ED8' },
  meta_ads:       { bg: '#EDE9FE', color: '#6D28D9' },
  tiktok_ads:     { bg: '#FCE7F3', color: '#9D174D' },
  linkedin_ads:   { bg: '#E0F2FE', color: '#0369A1' },
  organic_search: { bg: '#F0FDF4', color: '#15803D' },
  email:          { bg: '#FFF7ED', color: '#C2410C' },
  direct:         { bg: '#F3F4F6', color: '#374151' },
  referral:       { bg: '#FEFCE8', color: '#A16207' },
};

const NAVY = '#1B2A4A';

interface JourneyFlowComparisonProps {
  journeys: ChannelJourneyMap[];
}

export function JourneyFlowComparison({ journeys }: JourneyFlowComparisonProps) {
  const [pinnedChannels, setPinnedChannels] = useState<ChannelType[]>([]);

  if (journeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-[#E5E7EB] py-16 text-center">
        <GitBranch className="h-8 w-8 text-[#D1D5DB]" strokeWidth={1.5} />
        <div>
          <p className="text-section-header">Journey maps not yet computed</p>
          <p className="mt-1 text-body text-[#6B7280] max-w-sm mx-auto">
            Once sessions are ingested via{' '}
            <code className="bg-[#F3F4F6] px-1 py-0.5 rounded text-[11px]">
              POST /api/channels/ingest
            </code>
            , use the Refresh button to compute journey maps.
          </p>
        </div>
      </div>
    );
  }

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
      {/* ── Channel picker pills ──────────────────────────────────────── */}
      {journeys.length > 3 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption-upper self-center">Compare channels:</span>
          {journeys.map((j) => {
            const active = pinnedChannels.includes(j.channel);
            const cs = CHANNEL_STYLES[j.channel] ?? { bg: '#F3F4F6', color: '#374151' };
            return (
              <button
                key={j.channel}
                type="button"
                onClick={() => togglePin(j.channel)}
                className="rounded-full px-3 py-1 text-xs font-semibold border transition-all"
                style={
                  active
                    ? { backgroundColor: NAVY, borderColor: NAVY, color: '#fff' }
                    : { backgroundColor: cs.bg, borderColor: 'transparent', color: cs.color, opacity: 0.75 }
                }
              >
                {CHANNEL_LABELS[j.channel] ?? j.channel}
              </button>
            );
          })}
          {pinnedChannels.length > 0 && (
            <button
              type="button"
              onClick={() => setPinnedChannels([])}
              className="text-xs text-[#9CA3AF] hover:text-[#6B7280] underline underline-offset-2 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* ── Journey columns ───────────────────────────────────────────── */}
      <div className={`grid gap-4 ${cols}`}>
        {displayJourneys.map((journey) => {
          const cs = CHANNEL_STYLES[journey.channel] ?? { bg: '#F3F4F6', color: '#374151' };
          const hasSteps = journey.journey_steps.length > 0;
          const convPct = (journey.conversion_rate * 100).toFixed(1);
          const scs = (journey.signal_completion_score * 100).toFixed(0);

          return (
            <div
              key={journey.id}
              className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-3"
            >
              {/* Channel header */}
              <div>
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: cs.bg, color: cs.color }}
                >
                  {CHANNEL_LABELS[journey.channel] ?? journey.channel}
                </span>
                <div className="flex gap-3 mt-2 text-xs text-[#9CA3AF]">
                  <span className="font-medium text-[#6B7280]">{journey.total_sessions.toLocaleString()} sessions</span>
                  <span>{convPct}% conv.</span>
                  <span>SCS {scs}%</span>
                </div>
              </div>

              {/* Funnel steps */}
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
                  <p className="text-xs text-[#9CA3AF] italic py-2">
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
