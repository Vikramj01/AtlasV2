import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { SignalAggregates } from '@/types/signal-tracking';

interface DeltaProps {
  current: number | null;
  prev: number | null;
  /** true when a lower value is the improvement (e.g. latency) */
  lowerIsBetter?: boolean;
  suffix?: string;
}

function Delta({ current, prev, lowerIsBetter = false, suffix = '' }: DeltaProps) {
  if (current === null || prev === null || prev === 0) return null;
  const diff = current - prev;
  if (Math.abs(diff) < 0.05) return null;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? '▲' : '▼';
  return (
    <span className={cn('font-mono text-xs', improved ? 'text-console-green' : 'text-console-red')}>
      {arrow} {Math.abs(diff).toFixed(1)}{suffix} vs prior period
    </span>
  );
}

interface CardProps {
  label: string;
  value: string;
  colorClass: string;
  delta?: ReactNode;
}

function AggregateCard({ label, value, colorClass, delta }: CardProps) {
  return (
    <div className={cn('rounded-lg border border-console-border border-l-2 bg-console-surface px-5 py-[18px] flex-1 min-w-0', colorClass)}>
      <div className="font-heading text-xs font-semibold uppercase tracking-[0.1em] text-console-fg-subtle truncate">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-[26px] font-semibold text-console-fg">{value}</span>
      </div>
      {delta && <div className="mt-1">{delta}</div>}
    </div>
  );
}

function matchQualityColor(v: number | null): string {
  if (v === null) return 'border-l-console-fg-disabled';
  return v < 5 ? 'border-l-console-red' : v < 7 ? 'border-l-console-amber' : 'border-l-console-green';
}

function latencyColor(v: number | null): string {
  if (v === null) return 'border-l-console-fg-disabled';
  return v > 2000 ? 'border-l-console-red' : v > 500 ? 'border-l-console-amber' : 'border-l-console-green';
}

interface Props {
  aggregates: SignalAggregates | null;
}

/** Aggregate stat-card row above the signal table — total volume, match quality, dedup rate, p95 latency. */
export function SignalAggregateCards({ aggregates }: Props) {
  if (!aggregates) {
    return (
      <div className="grid grid-cols-2 gap-4 px-6 py-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-lg bg-console-chip" />
        ))}
      </div>
    );
  }

  const matchQuality = aggregates.avg_match_quality;
  const dedupRate = aggregates.dedup_hit_rate;
  const p95 = aggregates.p95_latency_ms;

  return (
    <div className="grid grid-cols-2 gap-4 px-6 py-4 lg:grid-cols-4">
      <AggregateCard
        label="Total Signals"
        value={aggregates.total_signals.toLocaleString()}
        colorClass="border-l-console-primary"
      />
      <AggregateCard
        label="Avg Match Quality"
        value={matchQuality !== null ? matchQuality.toFixed(1) : '—'}
        colorClass={matchQualityColor(matchQuality)}
        delta={<Delta current={matchQuality} prev={aggregates.prev_avg_match_quality} />}
      />
      <AggregateCard
        label="Dedup Hit Rate"
        value={dedupRate !== null ? `${dedupRate.toFixed(1)}%` : '—'}
        colorClass="border-l-console-cyan"
        delta={<Delta current={dedupRate} prev={aggregates.prev_dedup_hit_rate} suffix="%" />}
      />
      <AggregateCard
        label="P95 Latency"
        value={p95 !== null ? `${p95.toLocaleString()}ms` : '—'}
        colorClass={latencyColor(p95)}
        delta={<Delta current={aggregates.avg_latency_ms} prev={aggregates.prev_avg_latency_ms} lowerIsBetter suffix="ms" />}
      />
    </div>
  );
}
