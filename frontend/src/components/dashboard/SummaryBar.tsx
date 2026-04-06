/**
 * SummaryBar — 4-cell metric bar at the top of the Home Dashboard.
 *
 * Design spec:
 *   "Metric Bar: 4 equal cells. Health status cell should have a subtle
 *    tint matching its severity level."
 *   Label: 12px uppercase. Value: 24px semibold.
 */

import { cn } from '@/lib/utils';
import { MetricSkeleton } from '@/components/common/SkeletonCard';
import type { DashboardSummary, OverallHealth } from '@/types/dashboard';

// ── Health severity config ────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<OverallHealth, {
  label: string;
  dot: string;
  cellBg: string;
  cellBorder: string;
  valueColor: string;
}> = {
  healthy: {
    label:       'Healthy',
    dot:         'bg-[#059669]',
    cellBg:      'bg-[#F0FDF4]',
    cellBorder:  'border-[#059669]/30',
    valueColor:  'text-[#059669]',
  },
  attention: {
    label:       'Attention',
    dot:         'bg-[#D97706]',
    cellBg:      'bg-[#FFFBEB]',
    cellBorder:  'border-[#D97706]/30',
    valueColor:  'text-[#D97706]',
  },
  critical: {
    label:       'Critical',
    dot:         'bg-[#DC2626]',
    cellBg:      'bg-[#FEF2F2]',
    cellBorder:  'border-[#DC2626]/30',
    valueColor:  'text-[#DC2626]',
  },
};

// ── Metric value colour helpers ───────────────────────────────────────────────

function metricColor(value: number | null, warnBelow: number, badBelow: number): string {
  if (value === null) return 'text-[#6B7280]';
  if (value < badBelow)  return 'text-[#DC2626]';
  if (value < warnBelow) return 'text-[#D97706]';
  return 'text-[#059669]';
}

// ── Single metric cell ────────────────────────────────────────────────────────

interface MetricCellProps {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  subLabel?: string;
  /** Tinted background for the health cell */
  bg?: string;
  borderColor?: string;
}

function MetricCell({ label, value, valueColor, subLabel, bg, borderColor }: MetricCellProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-5 py-4 flex flex-col gap-1',
        bg ?? 'bg-white',
        borderColor ?? 'border-[#E5E7EB]',
      )}
    >
      {/* Label — 12px uppercase per spec */}
      <span className="text-caption-upper">{label}</span>
      {/* Value — 24px semibold per spec */}
      <span className={cn('text-2xl font-semibold leading-tight tabular-nums', valueColor ?? 'text-[#1A1A1A]')}>
        {value}
      </span>
      {subLabel && (
        <span className="text-caption">{subLabel}</span>
      )}
    </div>
  );
}

// ── Health cell (first cell, has dot + severity tint) ─────────────────────────

function HealthCell({ health }: { health: OverallHealth }) {
  const cfg = HEALTH_CONFIG[health];
  return (
    <div
      className={cn(
        'rounded-lg border px-5 py-4 flex flex-col gap-1',
        cfg.cellBg,
        cfg.cellBorder,
      )}
    >
      <span className="text-caption-upper">Overall Health</span>
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', cfg.dot)} />
        <span className={cn('text-2xl font-semibold leading-tight', cfg.valueColor)}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SummaryBarProps {
  summary: DashboardSummary;
  className?: string;
}

export function SummaryBar({ summary, className }: SummaryBarProps) {
  const cov = summary.signal_coverage_pct;
  const del = summary.capi_delivery_pct;
  const imp = summary.implementation_progress;

  return (
    <div className={cn('grid grid-cols-4 gap-4', className)}>
      {/* Cell 1 — Overall Health (severity tint) */}
      <HealthCell health={summary.overall_health} />

      {/* Cell 2 — Signal Coverage */}
      <MetricCell
        label="Signal Coverage"
        value={cov !== null ? `${cov}%` : '—'}
        valueColor={metricColor(cov, 70, 50)}
        subLabel="of key events tracked"
      />

      {/* Cell 3 — CAPI Delivery */}
      <MetricCell
        label="CAPI Delivery"
        value={del !== null ? `${del}%` : '—'}
        valueColor={metricColor(del, 90, 75)}
        subLabel="server-side delivery rate"
      />

      {/* Cell 4 — Implementation */}
      <MetricCell
        label="Implementation"
        value={imp !== null ? `${imp}%` : '—'}
        valueColor={metricColor(imp, 70, 0)}
        subLabel="of recommended events live"
      />
    </div>
  );
}

/** Skeleton shown while loading — 4 metric cells */
export function SummaryBarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-4 gap-4', className)}>
      {Array.from({ length: 4 }).map((_, i) => (
        <MetricSkeleton key={i} />
      ))}
    </div>
  );
}
