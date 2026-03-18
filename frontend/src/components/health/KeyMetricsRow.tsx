/**
 * KeyMetricsRow — 4 metric cards showing the key health sub-scores.
 */

import type { HealthScore } from '@/types/health';

interface MetricCardProps {
  label: string;
  value: string;
  subtext: string;
  status: 'good' | 'warning' | 'critical' | 'neutral';
}

const STATUS_COLORS = {
  good:     'text-green-600 bg-green-50 border-green-200',
  warning:  'text-amber-600 bg-amber-50 border-amber-200',
  critical: 'text-red-600 bg-red-50 border-red-200',
  neutral:  'text-muted-foreground bg-muted/30 border-border',
};

function MetricCard({ label, value, subtext, status }: MetricCardProps) {
  return (
    <div className={`rounded-xl border px-4 py-4 ${STATUS_COLORS[status]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs mt-1 opacity-60">{subtext}</p>
    </div>
  );
}

function tagStatus(v: number): MetricCardProps['status'] {
  if (v >= 90) return 'good';
  if (v >= 70) return 'warning';
  return 'critical';
}

function capiStatus(v: number): MetricCardProps['status'] {
  if (v === 0) return 'neutral';
  if (v >= 95) return 'good';
  if (v >= 85) return 'warning';
  return 'critical';
}

function consentStatus(v: number): MetricCardProps['status'] {
  return v >= 100 ? 'good' : 'warning';
}

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
      <MetricCard
        label="Signal Health"
        value={`${score.signal_health}%`}
        subtext={lastAuditText}
        status={score.signal_health === 0 ? 'neutral' : tagStatus(score.signal_health)}
      />
      <MetricCard
        label="CAPI Delivery"
        value={capiValue}
        subtext={score.capi_delivery_rate === 0 ? 'No providers connected' : 'Events delivered successfully'}
        status={capiStatus(score.capi_delivery_rate)}
      />
      <MetricCard
        label="Consent"
        value={score.consent_coverage >= 100 ? 'Configured' : 'Missing'}
        subtext={score.consent_coverage >= 100 ? 'Consent Hub active' : 'Set up Consent Hub'}
        status={consentStatus(score.consent_coverage)}
      />
      <MetricCard
        label="Tag Firing"
        value={`${score.tag_firing_rate}%`}
        subtext="Conversion events firing"
        status={score.tag_firing_rate === 0 ? 'neutral' : tagStatus(score.tag_firing_rate)}
      />
    </div>
  );
}
