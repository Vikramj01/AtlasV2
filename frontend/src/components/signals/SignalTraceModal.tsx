/**
 * SignalTraceModal
 *
 * Shows every destination one canonical business event (atlas_event_id) was
 * routed to — the "which platforms received this exact purchase" view. This
 * is what answers "the event ID should belong to the event, not the tag":
 * one row per destination with its native id, which platform field it was
 * written into, delivery status, dedup status, retries, and latency.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { signalEventsApi } from '@/lib/api/signalEventsApi';
import { DESTINATION_LABELS, DESTINATION_COLORS, statusBadge, dedupBadge } from '@/lib/signalDisplay';
import type { SignalEventTrace } from '@/types/signal-tracking';

interface Props {
  eventId: string;
  onClose: () => void;
}

export function SignalTraceModal({ eventId, onClose }: Props) {
  const [trace, setTrace] = useState<SignalEventTrace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    signalEventsApi
      .trace(eventId)
      .then((res) => { if (!cancelled) setTrace(res.data); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="flex w-full max-w-2xl flex-col overflow-hidden" style={{ maxHeight: '85vh' }}>
        <CardContent className="flex flex-col gap-4 overflow-hidden p-6">
          {/* Header */}
          <div>
            <h2 className="text-base font-bold">Event trace</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every destination this business event was routed to.
            </p>
            <p className="mt-1 font-mono text-xs text-[#1B2A4A]">{eventId}</p>
          </div>

          {/* Body */}
          {isLoading && (
            <div className="space-y-2">
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
            </div>
          )}

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          {!isLoading && !error && trace && trace.destinations.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No destinations found for this event.
            </p>
          )}

          {!isLoading && !error && trace && trace.destinations.length > 0 && (
            <div className="overflow-y-auto flex-1 space-y-2">
              {trace.destinations.map((row) => (
                <div key={row.id} className="rounded-lg border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${DESTINATION_COLORS[row.destination] ?? 'bg-gray-100 text-gray-800'}`}>
                      {DESTINATION_LABELS[row.destination] ?? row.destination}
                    </span>
                    <div className="flex items-center gap-2">
                      {statusBadge(row.status)}
                      {dedupBadge(row.dedup_status)}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Native id{row.native_id_field ? ` (${row.native_id_field})` : ''}:{' '}
                      <span className="font-mono text-[#374151]">{row.event_id ?? '—'}</span>
                    </span>
                    <span>Retries: <span className="text-[#374151]">{row.retry_count}</span></span>
                    <span>Latency: <span className="text-[#374151]">{row.latency_ms !== null ? `${row.latency_ms.toLocaleString()}ms` : '—'}</span></span>
                    <span>Event: <span className="text-[#374151]">{row.event_name}</span></span>
                  </div>
                  {row.error_message && (
                    <p className="mt-2 text-xs text-red-600">{row.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="border-t pt-4">
            <Button variant="ghost" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
