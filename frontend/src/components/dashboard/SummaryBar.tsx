'use client';

import { cn } from '@/lib/utils';
import type { DashboardSummary, OverallHealth } from '@/types/dashboard';

const HEALTH_CONFIG: Record<OverallHealth, { label: string; dot: string; bar: string }> = {
  healthy:   { label: 'Healthy',   dot: 'bg-green-500',  bar: 'bg-green-50 border-green-200' },
  attention: { label: 'Attention', dot: 'bg-amber-500',  bar: 'bg-amber-50 border-amber-200' },
  critical:  { label: 'Critical',  dot: 'bg-red-500',    bar: 'bg-red-50 border-red-200' },
};

interface MetricPillProps {
  label: string;
  value: number | string | null;
  unit?: string;
  status?: 'good' | 'warn' | 'bad' | 'neutral';
}

function MetricPill({ label, value, unit = '%', status = 'neutral' }: MetricPillProps) {
  const valueColor = {
    good:    'text-green-700',
    warn:    'text-amber-700',
    bad:     'text-red-700',
    neutral: 'text-foreground',
  }[status];

  return (
    <div className="flex flex-col items-center gap-0.5 sm:px-4 sm:first:pl-0 sm:last:pr-0 sm:border-r sm:last:border-r-0 sm:border-border/50">
      <span className={cn('text-lg font-bold tabular-nums leading-none', valueColor)}>
        {value === null ? '—' : `${value}${unit}`}
      </span>
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function metricStatus(value: number | null, warnBelow: number, badBelow: number): MetricPillProps['status'] {
  if (value === null) return 'neutral';
  if (value < badBelow) return 'bad';
  if (value < warnBelow) return 'warn';
  return 'good';
}

interface SummaryBarProps {
  summary: DashboardSummary;
  className?: string;
}

export function SummaryBar({ summary, className }: SummaryBarProps) {
  const health = HEALTH_CONFIG[summary.overall_health];

  return (
    <div className={cn('rounded-xl border px-5 py-4 flex items-center gap-6 flex-wrap', health.bar, className)}>
      {/* Overall health badge */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('h-2.5 w-2.5 rounded-full', health.dot)} />
        <span className="text-sm font-semibold text-foreground">{health.label}</span>
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* Metric pills — use gap on mobile (avoids broken border-r on wrap) */}
      <div className="flex items-center flex-wrap gap-x-6 gap-y-3 sm:gap-x-0 sm:gap-y-0">
        <MetricPill
          label="Signal Coverage"
          value={summary.signal_coverage_pct}
          status={metricStatus(summary.signal_coverage_pct, 70, 50)}
        />
        <MetricPill
          label="CAPI Delivery"
          value={summary.capi_delivery_pct}
          status={metricStatus(summary.capi_delivery_pct, 90, 75)}
        />
        {summary.avg_emq !== null && (
          <MetricPill
            label="Avg EMQ"
            value={summary.avg_emq.toFixed(1)}
            unit=""
            status={metricStatus(summary.avg_emq, 8, 6)}
          />
        )}
        <MetricPill
          label="Implementation"
          value={summary.implementation_progress}
          status={metricStatus(summary.implementation_progress, 70, 0)}
        />
      </div>
    </div>
  );
}

/** Skeleton shown while loading */
export function SummaryBarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-muted/30 px-5 py-4 flex items-center gap-6 animate-pulse', className)}>
      <div className="h-4 w-20 rounded bg-muted" />
      <div className="h-5 w-px bg-muted" />
      <div className="flex gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1 items-center">
            <div className="h-5 w-12 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
