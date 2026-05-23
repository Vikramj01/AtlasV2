import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { SignalEventRow } from '@/types/signal-tracking';

// ── Display helpers ───────────────────────────────────────────────────────────

const DESTINATION_LABELS: Record<string, string> = {
  meta:     'Meta',
  google:   'Google',
  tiktok:   'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

const DESTINATION_COLORS: Record<string, string> = {
  meta:     'bg-blue-100 text-blue-800',
  google:   'bg-red-100 text-red-800',
  tiktok:   'bg-gray-100 text-gray-800',
  linkedin: 'bg-sky-100 text-sky-800',
  snapchat: 'bg-yellow-100 text-yellow-800',
};

function statusBadge(status: string) {
  const success = status === 'delivered';
  const failure = status === 'delivery_failed' || status === 'dead_letter';
  const blocked = status === 'consent_blocked';

  if (success) return <Badge className="border-0 bg-[#DCFCE7] text-[#166534] text-xs">Success</Badge>;
  if (failure) return <Badge className="border-0 bg-[#FEE2E2] text-[#991B1B] text-xs">Failed</Badge>;
  if (blocked) return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E] text-xs">Blocked</Badge>;
  return <Badge variant="outline" className="text-xs text-[#6B7280]">{status}</Badge>;
}

function dedupBadge(dedup: string | null) {
  if (!dedup || dedup === 'not_applicable') return <span className="text-xs text-[#9CA3AF]">—</span>;
  if (dedup === 'hit')  return <Badge className="border-0 bg-[#DCFCE7] text-[#166534] text-xs">Matched</Badge>;
  if (dedup === 'miss') return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E] text-xs">Unmatched</Badge>;
  return <span className="text-xs text-[#6B7280]">{dedup}</span>;
}

function matchQualityCell(score: number | null) {
  if (score === null) return <span className="text-[#9CA3AF]">—</span>;
  const color = score < 5 ? 'text-[#DC2626]' : score < 7 ? 'text-[#D97706]' : 'text-[#16A34A]';
  return <span className={cn('font-medium tabular-nums', color)}>{score.toFixed(1)}</span>;
}

function latencyCell(ms: number | null, p95: number | null) {
  if (ms === null) return <span className="text-[#9CA3AF]">—</span>;
  const isOutlier = p95 !== null && ms > p95;
  const isHigh    = ms > 2000;
  const color = (isOutlier || isHigh) ? 'text-[#DC2626]' : ms > 500 ? 'text-[#D97706]' : 'text-[#374151]';
  return <span className={cn('tabular-nums', color)}>{ms.toLocaleString()}ms</span>;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── SignalFlowTable ───────────────────────────────────────────────────────────

interface Props {
  rows: SignalEventRow[];
  isLoading: boolean;
  hasMore: boolean;
  p95LatencyMs: number | null;
  onLoadMore: () => void;
}

export function SignalFlowTable({ rows, isLoading, hasMore, p95LatencyMs, onLoadMore }: Props) {
  const navigate = useNavigate();

  if (isLoading && rows.length === 0) {
    return (
      <div className="px-6 py-4 space-y-2">
        <SkeletonCard variant="row" />
        <SkeletonCard variant="row" />
        <SkeletonCard variant="row" />
        <SkeletonCard variant="row" />
        <SkeletonCard variant="row" />
      </div>
    );
  }

  if (!isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-[#374151]">No signals in this time range</p>
        <p className="mt-1 text-xs text-[#6B7280]">Adjust the filters or time range to find events.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" role="grid" aria-label="Signal flow">
        <thead>
          <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280] whitespace-nowrap">Timestamp</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Destination</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Event</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Event ID</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Status</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Dedup</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Match Quality</th>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-[#6B7280]">Latency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const eventId = row.event_id ?? row.atlas_event_id;
            return (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => navigate(`/signal-tracking/${encodeURIComponent(eventId)}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/signal-tracking/${encodeURIComponent(eventId)}`); }}
                className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB] cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A] focus-visible:ring-inset"
                aria-label={`Signal ${eventId}, ${row.event_name}, ${row.destination}, ${row.status}`}
              >
                <td className="px-4 py-2.5 text-xs text-[#374151] whitespace-nowrap font-mono">
                  {formatTimestamp(row.processed_at)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                    DESTINATION_COLORS[row.destination] ?? 'bg-gray-100 text-gray-800',
                  )}>
                    {DESTINATION_LABELS[row.destination] ?? row.destination}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-[#374151] font-medium">{row.event_name}</td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-[#1B2A4A] underline decoration-dotted">
                    {eventId.length > 16 ? `${eventId.slice(0, 16)}…` : eventId}
                  </span>
                </td>
                <td className="px-4 py-2.5">{statusBadge(row.status)}</td>
                <td className="px-4 py-2.5">{dedupBadge(row.dedup_status)}</td>
                <td className="px-4 py-2.5">{matchQualityCell(row.match_quality_score)}</td>
                <td className="px-4 py-2.5">{latencyCell(row.latency_ms, p95LatencyMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Load more / spinner */}
      <div className="flex justify-center py-4">
        {isLoading ? (
          <div className="h-5 w-5 rounded-full border-2 border-[#1B2A4A] border-t-transparent animate-spin" aria-label="Loading more signals" />
        ) : hasMore ? (
          <Button variant="outline" size="sm" onClick={onLoadMore}>Load more</Button>
        ) : rows.length > 0 ? (
          <p className="text-xs text-[#9CA3AF]">All signals loaded</p>
        ) : null}
      </div>
    </div>
  );
}
