/**
 * KeyMetricsRow — 4 metric cards showing health sub-scores.
 *
 * Design spec: "4-cell grid matching the metric bar pattern from Sprint 1.
 * Severity tint on cells that are critical/warning."
 * Label: 12px uppercase. Value: 24px semibold.
 */

import { cn } from '@/lib/utils';
import type { HealthScore } from '@/types/health';

// ── Severity config (matches SummaryBar pattern from Sprint 1) ────────────────

type CellStatus = 'good' | 'warning' | 'critical' | 'neutral';

const CELL_BG: Record<CellStatus, string> = {
  good:     'bg-white',
  warning:  'bg-[#FFFBEB]',
  critical: 'bg-[#FEF2F2]',
  neutral:  'bg-[#F9FAFB]',
};

const CELL_BORDER: Record<CellStatus, string> = {
  good:     'border-[#E5E7EB]',
  warning:  'border-[#D97706]/30',
  critical: 'border-[#DC2626]/30',
  neutral:  'border-[#E5E7EB]',
};

const VALUE_COLOR: Record<CellStatus, string> = {
  good:     'text-[#059669]',
  warning:  'text-[#D97706]',
  critical: 'text-[#DC2626]',
  neutral:  'text-[#6B7280]',
};

// ── Single metric cell ────────────────────────────────────────────────────────

interface MetricCellProps {
  label: string;
  value: string;
  subtext: string;
  status: CellStatus;
}

function MetricCell({ label, value, subtext, status }: MetricCellProps) {
  return (
    <div className={cn('rounded-lg border px-4 py-4', CELL_BG[status], CELL_BORDER[status])}>
      {/* Label — 12px uppercase per design spec */}
      <p className="text-caption-upper mb-1">{label}</p>
      {/* Value — 24px semibold per design spec */}
      <p className={cn('text-2xl font-semibold tabular-nums leading-tight', VALUE_COLOR[status])}>
        {value}
      </p>
      <p className="text-caption mt-1">{subtext}</p>
    </div>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────

function signalStatus(v: number): CellStatus {
  if (v === 0) return 'neutral';
  if (v >= 90) return 'good';
  if (v >= 70) return 'warning';
  return 'critical';
}

function capiStatus(v: number): CellStatus {
  if (v === 0) return 'neutral';
  if (v >= 95) return 'good';
  if (v >= 85) return 'warning';
  return 'critical';
}

function consentStatus(v: number): CellStatus {
  return v >= 100 ? 'good' : 'warning';
}

// ── Main component ────────────────────────────────────────────────────────────

interface KeyMetricsRowProps {
  score: HealthScore;
}

export function KeyMetricsRow({ score }: KeyMetricsRowProps) {
  const lastAuditText = score.last_audit_at
    ? `Last audit: ${new Date(score.last_audit_at).toLocaleDateString()}`
    : 'No audit yet';

  const capiValue = score.capi_delivery_rate === 0
    ? 'N/A'
    : `${score.capi_delivery_rate.toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCell
        label="Signal Health"
        value={`${score.signal_health}%`}
        subtext={lastAuditText}
        status={signalStatus(score.signal_health)}
      />
      <MetricCell
        label="CAPI Delivery"
        value={capiValue}
        subtext={score.capi_delivery_rate === 0 ? 'No providers connected' : 'Delivered successfully'}
        status={capiStatus(score.capi_delivery_rate)}
      />
      <MetricCell
        label="Consent"
        value={score.consent_coverage >= 100 ? 'Active' : 'Missing'}
        subtext={score.consent_coverage >= 100 ? 'Consent Hub active' : 'Set up Consent Hub'}
        status={consentStatus(score.consent_coverage)}
      />
      <MetricCell
        label="Tag Firing"
        value={`${score.tag_firing_rate}%`}
        subtext="Conversion events firing"
        status={signalStatus(score.tag_firing_rate)}
      />
    </div>
  );
}
