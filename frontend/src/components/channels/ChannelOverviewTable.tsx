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

const CHANNEL_COLORS: Record<ChannelType, string> = {
  google_ads:        'bg-blue-100 text-blue-700',
  meta_ads:          'bg-indigo-100 text-indigo-700',
  tiktok_ads:        'bg-purple-100 text-purple-700',
  linkedin_ads:      'bg-sky-100 text-sky-700',
  organic_search:    'bg-green-100 text-green-700',
  paid_search_other: 'bg-teal-100 text-teal-700',
  organic_social:    'bg-pink-100 text-pink-700',
  paid_social_other: 'bg-rose-100 text-rose-700',
  email:             'bg-orange-100 text-orange-700',
  referral:          'bg-amber-100 text-amber-700',
  direct:            'bg-gray-100 text-gray-700',
  other:             'bg-slate-100 text-slate-700',
};

export function ChannelOverviewTable({ overviews }: ChannelOverviewTableProps) {
  if (overviews.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-background px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No channel data yet. Send sessions via{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">POST /api/channels/ingest</code>{' '}
          to start seeing channel comparisons.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Channel</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Sessions</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Conv. Rate</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
              Avg Pages
            </th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">
              Avg Events
            </th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Signal Score</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Health</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {overviews.map((row) => (
            <tr key={row.channel} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                    CHANNEL_COLORS[row.channel]
                  }`}
                >
                  {CHANNEL_LABELS[row.channel] ?? row.channel}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">
                {row.total_sessions.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <span
                  className={
                    row.conversion_rate >= 0.05
                      ? 'text-green-600 font-medium'
                      : row.conversion_rate >= 0.02
                      ? 'text-amber-600'
                      : 'text-muted-foreground'
                  }
                >
                  {(row.conversion_rate * 100).toFixed(1)}%
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                {row.avg_pages_per_session.toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                {row.avg_events_per_session.toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <span className="text-xs font-semibold">
                  {(row.signal_completion_score * 100).toFixed(0)}%
                </span>
              </td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
