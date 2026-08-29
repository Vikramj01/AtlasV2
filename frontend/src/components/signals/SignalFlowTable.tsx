import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { DESTINATION_LABELS, DESTINATION_COLORS, statusBadge, dedupBadge } from '@/lib/signalDisplay';
import type { SignalEventRow } from '@/types/signal-tracking';

// ── Display helpers ───────────────────────────────────────────────────────────

function matchQualityCell(score: number | null) {
  if (score === null) return <span className="text-console-fg-disabled">—</span>;
  const color = score < 5 ? 'text-console-red' : score < 7 ? 'text-console-amber' : 'text-console-green';
  return <span className={cn('font-mono font-medium tabular-nums', color)}>{score.toFixed(1)}</span>;
}

function latencyCell(ms: number | null, p95: number | null) {
  if (ms === null) return <span className="text-console-fg-disabled">—</span>;
  const isOutlier = p95 !== null && ms > p95;
  const isHigh    = ms > 2000;
  const color = (isOutlier || isHigh) ? 'text-console-red' : ms > 500 ? 'text-console-amber' : 'text-console-fg-muted';
  return <span className={cn('font-mono tabular-nums', color)}>{ms.toLocaleString()}ms</span>;
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
        <p className="text-sm font-medium text-console-fg-muted">No signals in this time range</p>
        <p className="mt-1 text-xs text-console-fg-subtle">Adjust the filters or time range to find events.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" role="grid" aria-label="Signal flow">
        <thead>
          <tr className="border-b border-console-border bg-console-chip">
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle whitespace-nowrap">Timestamp</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Destination</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Event</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Event ID</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Status</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Dedup</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Match Quality</th>
            <th scope="col" className="px-4 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wide text-console-fg-subtle">Latency</th>
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
                className="border-b border-console-border hover:bg-console-chip cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-primary focus-visible:ring-inset"
                aria-label={`Signal ${eventId}, ${row.event_name}, ${row.destination}, ${row.status}`}
              >
                <td className="px-4 py-2.5 text-xs text-console-fg-muted whitespace-nowrap font-mono">
                  {formatTimestamp(row.processed_at)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                    DESTINATION_COLORS[row.destination] ?? 'bg-console-chip text-console-fg-muted',
                  )}>
                    {DESTINATION_LABELS[row.destination] ?? row.destination}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-console-fg font-medium">{row.event_name}</td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-console-primary underline decoration-dotted">
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
          <div className="h-5 w-5 rounded-full border-2 border-console-primary border-t-transparent animate-spin" aria-label="Loading more signals" />
        ) : hasMore ? (
          <Button variant="outline" size="sm" onClick={onLoadMore}>Load more</Button>
        ) : rows.length > 0 ? (
          <p className="text-xs text-console-fg-disabled">All signals loaded</p>
        ) : null}
      </div>
    </div>
  );
}
