/**
 * ActiveAlertsFeed — active health alerts using the SeverityCard system.
 *
 * Design spec:
 *   "Each alert card uses SeverityCard from Sprint 0."
 *   "Severity icon + title + 'So What?' tooltip on every item."
 */

import { useState } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import { SeverityCard } from '@/components/common/SeverityCard';
import type { SeverityLevel } from '@/components/common/SeverityCard';
import { InfoTooltip } from '@/components/common/EducationTooltip';
import type { HealthAlert } from '@/types/health';
import { healthApi } from '@/lib/api/healthApi';

// ── Severity mapping ──────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<HealthAlert['severity'], SeverityLevel> = {
  critical: 'critical',
  warning:  'warning',
  info:     'info',
};

const BADGE_STYLES: Record<HealthAlert['severity'], string> = {
  critical: 'bg-[#FEF2F2] text-[#DC2626] border border-[#DC2626]/20',
  warning:  'bg-[#FFFBEB] text-[#D97706] border border-[#D97706]/20',
  info:     'bg-[#EFF6FF] text-[#2E75B6] border border-[#2E75B6]/20',
};

// Tooltip content keys — map alert types to tooltipContent dictionary
// Falls back gracefully if key isn't found (EducationTooltip silently renders nothing)
function alertTooltipKey(alert: HealthAlert): string {
  // Use the alert's metric type if available, otherwise fall back to severity-level guidance
  const base = (alert as unknown as { metric_type?: string }).metric_type;
  if (base) return `health.${base}`;
  return `health.${alert.severity}_default`;
}

// ── Single alert card ─────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: HealthAlert;
  onAcknowledge: (id: string) => void;
}

function AlertCard({ alert, onAcknowledge }: AlertCardProps) {
  const [loading, setLoading] = useState(false);
  const severity = SEVERITY_MAP[alert.severity];
  const isAcknowledged = alert.acknowledged_at !== null;

  async function handleAck() {
    setLoading(true);
    try {
      await healthApi.acknowledgeAlert(alert.id);
      onAcknowledge(alert.id);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <SeverityCard
      severity={severity}
      compact
      className={isAcknowledged ? 'opacity-60' : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Header row: badge + acknowledged indicator + tooltip */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BADGE_STYLES[alert.severity]}`}>
              {alert.severity.toUpperCase()}
            </span>
            {isAcknowledged && (
              <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
                Acknowledged
              </span>
            )}
            {/* "So What?" tooltip — design spec: all ℹ icons show guidance */}
            <InfoTooltip contentKey={alertTooltipKey(alert)} />
          </div>

          {/* Title */}
          <p className="text-sm font-semibold text-[#1A1A1A]">{alert.title}</p>
          {/* Message */}
          <p className="text-xs text-[#6B7280] mt-0.5 leading-relaxed">{alert.message}</p>
          {/* Timestamp */}
          <p className="text-[10px] text-[#9CA3AF] mt-1.5">
            Triggered {new Date(alert.triggered_at).toLocaleDateString()}
          </p>
        </div>

        {/* Acknowledge button */}
        {!isAcknowledged && (
          <button
            type="button"
            onClick={handleAck}
            disabled={loading}
            className="shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
            title="Dismiss alert"
          >
            <X className="h-3.5 w-3.5 text-[#9CA3AF]" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </SeverityCard>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────

interface ActiveAlertsFeedProps {
  alerts: HealthAlert[];
}

export function ActiveAlertsFeed({ alerts }: ActiveAlertsFeedProps) {
  const [local, setLocal] = useState<HealthAlert[]>(alerts);

  function handleAcknowledge(id: string) {
    setLocal((prev) =>
      prev.map((a) => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a),
    );
  }

  if (local.length === 0) {
    return (
      <SeverityCard severity="success" compact>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[#059669] shrink-0" strokeWidth={1.5} />
          <p className="text-sm font-medium text-[#059669]">
            No active alerts — everything looks good.
          </p>
        </div>
      </SeverityCard>
    );
  }

  const sorted = [...local].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
      ))}
    </div>
  );
}
