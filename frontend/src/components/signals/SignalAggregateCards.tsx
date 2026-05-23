import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SignalAggregates, SignalFilters } from '@/types/signal-tracking';

// ── Sparkline (pure SVG) ──────────────────────────────────────────────────────

function Sparkline({ data }: { data: Array<{ day: string; signal_count: number }> }) {
  if (data.length < 2) {
    return <div className="h-10 w-full" />;
  }

  const W = 120;
  const H = 32;
  const counts = data.map((d) => d.signal_count);
  const max = Math.max(...counts, 1);
  const min = Math.min(...counts);
  const range = max - min || 1;

  const pts = counts.map((c, i) => {
    const x = (i / (counts.length - 1)) * W;
    const y = H - ((c - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  const fill = `${pts.join(' ')} ${W},${H} 0,${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2A4A" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1B2A4A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill="url(#sg)" />
      <polyline points={polyline} fill="none" stroke="#1B2A4A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Trend indicator ───────────────────────────────────────────────────────────

function Trend({ current, previous, higherIsBetter = true, unit = '' }: {
  current: number | null;
  previous: number | null;
  higherIsBetter?: boolean;
  unit?: string;
}) {
  if (current === null || previous === null || previous === 0) {
    return <span className="text-[10px] text-[#9CA3AF]">No prev. data</span>;
  }
  const delta = current - previous;
  const pct   = Math.abs((delta / previous) * 100).toFixed(1);
  const up    = delta > 0;
  const neutral = Math.abs(delta) < 0.01;

  const positive = neutral ? false : (higherIsBetter ? up : !up);
  const color = neutral ? 'text-[#9CA3AF]' : positive ? 'text-[#16A34A]' : 'text-[#DC2626]';
  const Icon  = neutral ? Minus : up ? TrendingUp : TrendingDown;

  return (
    <span className={cn('flex items-center gap-0.5 text-[10px] font-medium', color)}>
      <Icon className="h-3 w-3" />
      {neutral ? 'No change' : `${up ? '+' : '-'}${pct}${unit} vs prev`}
    </span>
  );
}

// ── Single card ───────────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  value: string;
  subtext: string;
  sparkline: Array<{ day: string; signal_count: number }>;
  trend: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

function AggCard({ title, value, subtext, sparkline, trend, onClick, active }: CardProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className={cn(
        'rounded-lg border bg-white px-4 py-3 flex flex-col gap-1 transition-colors',
        onClick ? 'cursor-pointer hover:border-[#1B2A4A]/40 hover:shadow-sm' : '',
        active ? 'border-[#1B2A4A] ring-1 ring-[#1B2A4A]/20' : 'border-[#E5E7EB]',
      )}
      aria-pressed={onClick ? active : undefined}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{title}</p>
      <p className="text-2xl font-semibold text-[#1A1A1A] tabular-nums leading-tight">{value}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[#9CA3AF]">{subtext}</span>
        {trend}
      </div>
      <div className="mt-1">
        <Sparkline data={sparkline} />
      </div>
    </div>
  );
}

// ── SignalAggregateCards ──────────────────────────────────────────────────────

interface Props {
  aggregates: SignalAggregates | null;
  isLoading: boolean;
  activeCard: string | null;
  onCardClick: (card: string, filterPatch: Partial<SignalFilters>) => void;
}

function fmtNum(n: number | null, decimals = 1, suffix = ''): string {
  if (n === null) return '—';
  return `${n.toFixed(decimals)}${suffix}`;
}

export function SignalAggregateCards({ aggregates, isLoading, activeCard, onCardClick }: Props) {
  if (isLoading && !aggregates) {
    return (
      <div className="grid grid-cols-2 gap-3 px-6 py-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-lg border border-[#E5E7EB] bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  const sparkline = aggregates?.sparkline ?? [];

  return (
    <div className="grid grid-cols-2 gap-3 px-6 py-4 lg:grid-cols-4" role="group" aria-label="Signal aggregate metrics">
      <AggCard
        title="Total Signals"
        value={aggregates ? aggregates.total_signals.toLocaleString() : '—'}
        subtext="In selected range"
        sparkline={sparkline}
        trend={<span className="text-[10px] text-[#9CA3AF]">7-day trend</span>}
      />

      <AggCard
        title="Match Quality"
        value={fmtNum(aggregates?.avg_match_quality ?? null, 1, '/10')}
        subtext="Avg EMQ proxy score"
        sparkline={[]}
        trend={
          <Trend
            current={aggregates?.avg_match_quality ?? null}
            previous={aggregates?.prev_avg_match_quality ?? null}
            higherIsBetter
          />
        }
      />

      <AggCard
        title="Dedup Health"
        value={fmtNum(aggregates?.dedup_hit_rate ?? null, 1, '%')}
        subtext="Signals matched"
        sparkline={[]}
        active={activeCard === 'dedup'}
        onClick={() =>
          onCardClick('dedup', {
            dedup_statuses: activeCard === 'dedup' ? [] : ['miss'],
          })
        }
        trend={
          <Trend
            current={aggregates?.dedup_hit_rate ?? null}
            previous={aggregates?.prev_dedup_hit_rate ?? null}
            higherIsBetter
            unit="%"
          />
        }
      />

      <AggCard
        title="Avg Latency"
        value={aggregates?.avg_latency_ms !== null && aggregates?.avg_latency_ms !== undefined
          ? `${Math.round(aggregates.avg_latency_ms).toLocaleString()}ms`
          : '—'}
        subtext={aggregates?.p95_latency_ms ? `p95: ${Math.round(aggregates.p95_latency_ms)}ms` : 'p95 unavailable'}
        sparkline={[]}
        trend={
          <Trend
            current={aggregates?.avg_latency_ms ?? null}
            previous={aggregates?.prev_avg_latency_ms ?? null}
            higherIsBetter={false}
            unit="ms"
          />
        }
      />
    </div>
  );
}
