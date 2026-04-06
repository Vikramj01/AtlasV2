import { ChannelHealthIndicator } from './ChannelHealthIndicator';
import type { ChannelOverview, ChannelType } from '@/types/channel';

interface ChannelOverviewTableProps {
  overviews: ChannelOverview[];
}

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

// Channel pills — distinct but subdued, not raw Tailwind color-600
const CHANNEL_STYLES: Partial<Record<ChannelType, { bg: string; color: string }>> = {
  google_ads:        { bg: '#DBEAFE', color: '#1D4ED8' },
  meta_ads:          { bg: '#EDE9FE', color: '#6D28D9' },
  tiktok_ads:        { bg: '#FCE7F3', color: '#9D174D' },
  linkedin_ads:      { bg: '#E0F2FE', color: '#0369A1' },
  organic_search:    { bg: '#F0FDF4', color: '#15803D' },
  paid_search_other: { bg: '#F0FDFA', color: '#0F766E' },
  organic_social:    { bg: '#FDF4FF', color: '#7E22CE' },
  email:             { bg: '#FFF7ED', color: '#C2410C' },
  referral:          { bg: '#FEFCE8', color: '#A16207' },
  direct:            { bg: '#F3F4F6', color: '#374151' },
};

const NAVY = '#1B2A4A';

function SignalScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 rounded-full bg-[#EEF1F7] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums w-8 text-right" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

export function ChannelOverviewTable({ overviews }: ChannelOverviewTableProps) {
  if (overviews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-white px-6 py-12 text-center">
        <p className="text-sm text-[#6B7280]">
          No channel data yet. Send sessions via{' '}
          <code className="text-xs bg-[#F3F4F6] px-1 py-0.5 rounded">POST /api/channels/ingest</code>{' '}
          to start seeing channel comparisons.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E5E7EB]" style={{ backgroundColor: '#F9FAFB' }}>
            <th className="text-left px-4 py-3 text-caption-upper">Channel</th>
            <th className="text-right px-4 py-3 text-caption-upper">Sessions</th>
            <th className="text-right px-4 py-3 text-caption-upper">Conv. Rate</th>
            <th className="text-right px-4 py-3 text-caption-upper hidden sm:table-cell">Avg Pages</th>
            <th className="text-right px-4 py-3 text-caption-upper hidden md:table-cell">Avg Events</th>
            <th className="text-right px-4 py-3 text-caption-upper">Signal Score</th>
            <th className="text-right px-4 py-3 text-caption-upper">Health</th>
          </tr>
        </thead>
        <tbody>
          {overviews.map((row, i) => {
            const style = CHANNEL_STYLES[row.channel] ?? { bg: '#F3F4F6', color: '#374151' };
            const convPct = row.conversion_rate * 100;
            const convColor = convPct >= 5 ? '#059669' : convPct >= 2 ? '#D97706' : '#9CA3AF';

            return (
              <tr
                key={row.channel}
                className="hover:bg-[#F9FAFB] transition-colors"
                style={i < overviews.length - 1 ? { borderBottom: '1px solid #E5E7EB' } : {}}
              >
                {/* Channel pill */}
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {CHANNEL_LABELS[row.channel] ?? row.channel}
                  </span>
                </td>

                {/* Sessions */}
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#1A1A1A]">
                  {row.total_sessions.toLocaleString()}
                </td>

                {/* Conversion rate */}
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className="text-sm font-semibold" style={{ color: convColor }}>
                    {convPct.toFixed(1)}%
                  </span>
                </td>

                {/* Avg pages */}
                <td className="px-4 py-3 text-right tabular-nums text-[#9CA3AF] hidden sm:table-cell">
                  {row.avg_pages_per_session.toFixed(1)}
                </td>

                {/* Avg events */}
                <td className="px-4 py-3 text-right tabular-nums text-[#9CA3AF] hidden md:table-cell">
                  {row.avg_events_per_session.toFixed(1)}
                </td>

                {/* Signal score bar */}
                <td className="px-4 py-3">
                  <SignalScoreBar score={row.signal_completion_score} />
                </td>

                {/* Health indicator */}
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end">
                    <ChannelHealthIndicator
                      status={row.health_status}
                      score={row.signal_completion_score}
                      showLabel={false}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Expose NAVY for potential reuse
export { NAVY };
