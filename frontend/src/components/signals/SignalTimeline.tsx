import { cn } from '@/lib/utils';
import type { SignalEventDetail } from '@/types/signal-tracking';

interface TimelineStep {
  label: string;
  sublabel: string;
  ts: string | null;
  done: boolean;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface Props {
  signal: SignalEventDetail;
}

export function SignalTimeline({ signal }: Props) {
  const steps: TimelineStep[] = [
    {
      label:    'Event received',
      sublabel: 'Atlas ingested the signal',
      ts:       signal.processed_at,
      done:     true,
    },
    {
      label:    'Sent to destination',
      sublabel: signal.destination,
      ts:       signal.delivered_at ?? signal.processed_at,
      done:     signal.status === 'delivered' || signal.status === 'delivery_failed',
    },
    {
      label:    'Dedup decision',
      sublabel: signal.dedup_status === 'hit'
        ? 'Duplicate matched — suppressed'
        : signal.dedup_status === 'miss'
          ? 'No duplicate found — passed'
          : 'Dedup not applicable',
      ts:       signal.dedup_matched_at,
      done:     signal.dedup_status !== null,
    },
    {
      label:    'Response received',
      sublabel: signal.status === 'delivered'
        ? 'Platform accepted'
        : signal.status === 'delivery_failed'
          ? 'Platform rejected'
          : 'Pending',
      ts:       signal.delivered_at,
      done:     signal.delivered_at !== null,
    },
  ];

  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-[#1A1A1A] mb-4">Timeline</h2>

      <div className="relative flex items-start justify-between gap-2">
        {/* Connecting line */}
        <div className="absolute top-3 left-0 right-0 h-px bg-[#E5E7EB]" aria-hidden />

        {steps.map((step, i) => (
          <div key={i} className="relative flex flex-1 flex-col items-center gap-1 min-w-0">
            {/* Dot */}
            <span className={cn(
              'z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold',
              step.done
                ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                : 'border-[#E5E7EB] bg-white text-[#9CA3AF]',
            )}
              aria-hidden
            >
              {i + 1}
            </span>

            {/* Labels */}
            <p className="text-center text-[11px] font-semibold text-[#374151] leading-tight px-1">{step.label}</p>
            <p className="text-center text-[10px] text-[#9CA3AF] leading-tight px-1 truncate w-full">{step.sublabel}</p>
            {step.ts && (
              <p className="text-center text-[10px] font-mono text-[#6B7280] leading-tight px-1">
                {fmt(step.ts)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Latency callout */}
      {signal.latency_ms !== null && (
        <p className="mt-4 text-center text-xs text-[#6B7280]">
          End-to-end latency: <span className="font-medium text-[#374151]">{signal.latency_ms.toLocaleString()}ms</span>
        </p>
      )}
    </section>
  );
}
