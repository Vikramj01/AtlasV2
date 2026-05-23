import { cn } from '@/lib/utils';
import type { SignalEventDetail } from '@/types/signal-tracking';

// ── Dimension definitions ─────────────────────────────────────────────────────

interface Dimension {
  id: string;
  label: string;
  description: (signal: SignalEventDetail) => string;
  contributing: (signal: SignalEventDetail) => boolean;
  severity: (signal: SignalEventDetail) => 'good' | 'warn' | 'bad' | 'neutral';
}

const DIMENSIONS: Dimension[] = [
  {
    id:    'emq',
    label: 'Event Match Quality',
    description: (s) => s.match_quality_score !== null
      ? `Score: ${s.match_quality_score.toFixed(1)}/10${s.match_quality_score < 5 ? ' — below threshold, may reduce ad platform match rates' : ''}`
      : 'No match quality score recorded for this signal',
    contributing: (s) => s.match_quality_score !== null,
    severity: (s) => {
      if (s.match_quality_score === null) return 'neutral';
      if (s.match_quality_score >= 7)    return 'good';
      if (s.match_quality_score >= 5)    return 'warn';
      return 'bad';
    },
  },
  {
    id:    'dedup',
    label: 'Dedup Health',
    description: (s) => {
      if (s.dedup_status === 'hit')             return 'Duplicate detected and suppressed — deduplication working correctly';
      if (s.dedup_status === 'miss')            return 'No duplicate found — this signal passed as a unique event';
      if (s.dedup_status === 'not_applicable')  return 'Deduplication not applicable for this event type';
      return 'Dedup status not recorded';
    },
    contributing: (s) => s.dedup_status !== null,
    severity: (s) => {
      if (s.dedup_status === null)              return 'neutral';
      if (s.dedup_status === 'miss')            return 'good';
      if (s.dedup_status === 'hit')             return 'warn';
      return 'neutral';
    },
  },
  {
    id:    'latency',
    label: 'Signal Latency',
    description: (s) => s.latency_ms !== null
      ? `${s.latency_ms.toLocaleString()}ms end-to-end${s.latency_ms > 2000 ? ' — high latency may cause attribution window issues' : ''}`
      : 'Latency not recorded for this signal',
    contributing: (s) => s.latency_ms !== null,
    severity: (s) => {
      if (s.latency_ms === null)    return 'neutral';
      if (s.latency_ms <= 500)     return 'good';
      if (s.latency_ms <= 2000)    return 'warn';
      return 'bad';
    },
  },
  {
    id:    'freshness',
    label: 'Signal Freshness',
    description: (s) => {
      const ageMs = Date.now() - new Date(s.processed_at).getTime();
      const ageMin = Math.round(ageMs / 60_000);
      return ageMin < 60
        ? `Sent ${ageMin}m ago — within attribution window`
        : `Sent ${Math.round(ageMin / 60)}h ago`;
    },
    contributing: () => true,
    severity: (s) => {
      const ageH = (Date.now() - new Date(s.processed_at).getTime()) / 3_600_000;
      if (ageH < 1)   return 'good';
      if (ageH < 24)  return 'warn';
      return 'neutral';
    },
  },
  {
    id:    'delivery',
    label: 'Funnel Completeness',
    description: (s) => {
      if (s.status === 'delivered')       return `Delivered to ${s.destination} — contributing to funnel coverage`;
      if (s.status === 'delivery_failed') return `Delivery failed — this event is missing from ${s.destination} attribution`;
      if (s.status === 'consent_blocked') return 'Blocked by consent — not sent to destination';
      return `Status: ${s.status}`;
    },
    contributing: (s) => s.status === 'delivered',
    severity: (s) => {
      if (s.status === 'delivered')       return 'good';
      if (s.status === 'delivery_failed') return 'bad';
      if (s.status === 'consent_blocked') return 'warn';
      return 'neutral';
    },
  },
];

// ── Severity styles ───────────────────────────────────────────────────────────

const DOT_COLOR = {
  good:    'bg-[#16A34A]',
  warn:    'bg-[#D97706]',
  bad:     'bg-[#DC2626]',
  neutral: 'bg-[#9CA3AF]',
};

const ROW_BG = {
  good:    '',
  warn:    'bg-[#FFFBEB]/50',
  bad:     'bg-[#FEF2F2]/50',
  neutral: '',
};

// ── AndromedaAnnotations ──────────────────────────────────────────────────────

interface Props {
  signal: SignalEventDetail;
}

export function AndromedaAnnotations({ signal }: Props) {
  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[#F3F4F6]">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Andromeda Dimensions</h2>
        <p className="text-[11px] text-[#9CA3AF] mt-0.5">How this signal contributes to your five signal health dimensions</p>
      </div>

      <div className="divide-y divide-[#F3F4F6]">
        {DIMENSIONS.map((dim) => {
          const sev  = dim.severity(signal);
          const desc = dim.description(signal);
          const contributing = dim.contributing(signal);

          return (
            <div key={dim.id} className={cn('flex items-start gap-3 px-4 py-3', ROW_BG[sev])}>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT_COLOR[sev])} aria-hidden />
              <div className="min-w-0">
                <p className={cn(
                  'text-xs font-semibold',
                  contributing ? 'text-[#374151]' : 'text-[#9CA3AF]',
                )}>
                  {dim.label}
                </p>
                <p className="text-[11px] text-[#6B7280] mt-0.5 leading-snug">{desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
