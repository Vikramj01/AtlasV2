import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { signalEventsApi } from '@/lib/api/signalEventsApi';
import { SignalTimeline } from '@/components/signals/SignalTimeline';
import { SignalPayloadViewer } from '@/components/signals/SignalPayloadViewer';
import { AndromedaAnnotations } from '@/components/signals/AndromedaAnnotations';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { SignalEventDetail, SignalEventRow } from '@/types/signal-tracking';

// ── Badge helpers ─────────────────────────────────────────────────────────────

const DESTINATION_LABELS: Record<string, string> = {
  meta: 'Meta', google: 'Google', tiktok: 'TikTok', linkedin: 'LinkedIn', snapchat: 'Snapchat',
};

function StatusBadge({ status }: { status: string }) {
  if (status === 'delivered')
    return <Badge className="border-0 bg-[#DCFCE7] text-[#166534]">Success</Badge>;
  if (status === 'delivery_failed' || status === 'dead_letter')
    return <Badge className="border-0 bg-[#FEE2E2] text-[#991B1B]">Failed</Badge>;
  if (status === 'consent_blocked')
    return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E]">Consent Blocked</Badge>;
  return <Badge variant="outline" className="text-[#6B7280]">{status}</Badge>;
}

function DedupBadge({ status }: { status: string | null }) {
  if (!status || status === 'not_applicable') return null;
  if (status === 'hit')  return <Badge className="border-0 bg-[#DCFCE7] text-[#166534]">Dedup Matched</Badge>;
  if (status === 'miss') return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E]">Dedup Unmatched</Badge>;
  return null;
}

// ── Related signals table ─────────────────────────────────────────────────────

function RelatedSignals({ rows }: { rows: SignalEventRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[#F3F4F6]">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Related Signals</h2>
        <p className="text-[11px] text-[#9CA3AF] mt-0.5">Other signals sharing the same dedup key</p>
      </div>
      <div className="divide-y divide-[#F3F4F6]">
        {rows.map((r) => {
          const id = r.event_id ?? r.atlas_event_id;
          return (
            <Link
              key={r.id}
              to={`/signal-tracking/${encodeURIComponent(id)}`}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-[#F9FAFB] transition-colors"
            >
              <div>
                <span className="text-xs font-medium text-[#374151]">{r.event_name}</span>
                <span className="ml-2 text-[11px] text-[#9CA3AF]">
                  {DESTINATION_LABELS[r.destination] ?? r.destination}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[#9CA3AF]">
                  {new Date(r.processed_at).toLocaleTimeString()}
                </span>
                <StatusBadge status={r.status} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── SignalDetailPage ──────────────────────────────────────────────────────────

export function SignalDetailPage() {
  const { event_id } = useParams<{ event_id: string }>();
  const navigate     = useNavigate();
  const [signal, setSignal]   = useState<SignalEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!event_id) return;
    setLoading(true);
    setError(null);

    signalEventsApi.detail(event_id)
      .then((res) => setSignal(res.data))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg.includes('404') ? 'Signal not found' : msg);
      })
      .finally(() => setLoading(false));
  }, [event_id]);

  if (loading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <SkeletonCard variant="card" />
        <SkeletonCard variant="card" />
        <SkeletonCard variant="card" />
      </div>
    );
  }

  if (error || !signal) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm font-medium text-[#374151]">{error ?? 'Signal not found'}</p>
        <button
          onClick={() => navigate('/signal-tracking')}
          className="text-xs text-[#1B2A4A] underline"
        >
          Back to Signal Tracking
        </button>
      </div>
    );
  }

  const displayEventId = signal.event_id ?? signal.atlas_event_id;

  return (
    <div className="flex flex-col gap-4 px-6 py-4 max-w-4xl">
      {/* Back nav */}
      <Link
        to="/signal-tracking"
        className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#374151] w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Signal Tracking
      </Link>

      {/* Header */}
      <section className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-[#1A1A1A]">{signal.event_name}</h1>
            <p className="text-xs font-mono text-[#9CA3AF] mt-0.5 break-all">{displayEventId}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-xs">
              {DESTINATION_LABELS[signal.destination] ?? signal.destination}
            </Badge>
            <StatusBadge status={signal.status} />
            <DedupBadge status={signal.dedup_status} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#6B7280]">
          <span>
            <span className="font-medium text-[#374151]">Received: </span>
            {new Date(signal.processed_at).toLocaleString()}
          </span>
          {signal.match_quality_score !== null && (
            <span>
              <span className="font-medium text-[#374151]">Match quality: </span>
              {signal.match_quality_score.toFixed(1)}/10
            </span>
          )}
          {signal.latency_ms !== null && (
            <span>
              <span className="font-medium text-[#374151]">Latency: </span>
              {signal.latency_ms.toLocaleString()}ms
            </span>
          )}
          {signal.error_message && (
            <span className="text-[#DC2626]">
              <span className="font-medium">Error: </span>{signal.error_message}
            </span>
          )}
        </div>
      </section>

      {/* Timeline */}
      <SignalTimeline signal={signal} />

      {/* Payload + Response */}
      <SignalPayloadViewer title="Request Payload" data={signal.payload} />
      <SignalPayloadViewer title="Platform Response" data={signal.response} defaultOpen={false} />

      {/* Andromeda */}
      <AndromedaAnnotations signal={signal} />

      {/* Related signals */}
      <RelatedSignals rows={signal.related_signals} />
    </div>
  );
}
