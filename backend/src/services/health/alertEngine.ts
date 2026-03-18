/**
 * Alert Engine
 *
 * Evaluates computed health metrics against thresholds and manages
 * the lifecycle of health_alerts records:
 *
 *  - Metric BREACHES threshold → create alert (if not already active)
 *  - Metric RECOVERS           → increment consecutive_ok_count
 *  - consecutive_ok_count ≥ 2  → auto-resolve alert
 *
 * Alert types and thresholds:
 *   capi_delivery       < 95%   → critical
 *   tag_firing          < 80%   → critical
 *   tag_firing          < 90%   → warning
 *   consent_missing     = 0     → warning
 *   no_recent_audit     > 30d   → warning
 *   capi_not_configured (none)  → info
 */

import type { ComputedMetrics } from '@/types/health';
import type { AlertType } from '@/types/health';
import {
  getAlertByType,
  createAlert,
  incrementAlertOk,
  resolveAlert,
} from '@/services/database/healthQueries';
import logger from '@/utils/logger';

// ── Alert rule definitions ────────────────────────────────────────────────────

interface AlertRule {
  type: AlertType;
  check: (m: ComputedMetrics, raw: RawMetrics) => boolean; // true = threshold breached
  severity: 'critical' | 'warning' | 'info';
  title: string;
  getMessage: (m: ComputedMetrics, raw: RawMetrics) => string;
  getMetricValue: (m: ComputedMetrics) => number | null;
  threshold: number | null;
}

interface RawMetrics extends ComputedMetrics {
  capi_configured: boolean;  // true if at least one active CAPI provider exists
  days_since_audit: number | null;
}

const ALERT_RULES: AlertRule[] = [
  {
    type: 'capi_delivery',
    check: (_, r) => r.capi_configured && r.capi_delivery_rate < 95,
    severity: 'critical',
    title: 'CAPI Delivery Below Threshold',
    getMessage: (m) =>
      `Your Conversion API is delivering ${m.capi_delivery_rate.toFixed(1)}% of events successfully. This means conversion signals are being lost before reaching ad platforms.`,
    getMetricValue: (m) => m.capi_delivery_rate,
    threshold: 95,
  },
  {
    type: 'tag_firing',
    check: (m) => m.signal_health > 0 && m.signal_health < 80,
    severity: 'critical',
    title: 'Significant Tag Firing Issues Detected',
    getMessage: (m) =>
      `Your conversion signal health score is ${m.signal_health}%. Multiple critical tracking events are not firing correctly, which will reduce ad platform optimisation.`,
    getMetricValue: (m) => m.signal_health,
    threshold: 80,
  },
  {
    type: 'tag_firing',
    check: (m) => m.signal_health >= 80 && m.signal_health < 90,
    severity: 'warning',
    title: 'Some Tracking Issues Detected',
    getMessage: (m) =>
      `Your conversion signal health score is ${m.signal_health}%. Some tracking events may not be firing correctly.`,
    getMetricValue: (m) => m.signal_health,
    threshold: 90,
  },
  {
    type: 'consent_missing',
    check: (m) => m.consent_coverage === 0,
    severity: 'warning',
    title: 'Consent Management Not Configured',
    getMessage: () =>
      'No consent management is configured for this property. Without consent management, your tracking may not comply with GDPR or CCPA regulations.',
    getMetricValue: () => 0,
    threshold: 100,
  },
  {
    type: 'no_recent_audit',
    check: (_, r) => r.days_since_audit === null || r.days_since_audit > 30,
    severity: 'warning',
    title: 'No Recent Audit',
    getMessage: (_, r) =>
      r.days_since_audit === null
        ? 'No audits have been run yet. Run an audit to validate your tracking implementation.'
        : `Your last audit was ${r.days_since_audit} days ago. Run a fresh audit to ensure tracking is still working correctly.`,
    getMetricValue: (_m) => null,
    threshold: 30,
  },
  {
    type: 'capi_not_configured',
    check: (_, r) => !r.capi_configured,
    severity: 'info',
    title: 'Server-Side Tracking Not Configured',
    getMessage: () =>
      'No Conversion API providers are connected. Server-side tracking typically recovers 40–60% of conversion signals lost to ad blockers and browser privacy restrictions.',
    getMetricValue: () => 0,
    threshold: null,
  },
];

// ── Alert lifecycle management ────────────────────────────────────────────────

async function evaluateRule(
  userId: string,
  rule: AlertRule,
  metrics: ComputedMetrics,
  raw: RawMetrics,
): Promise<void> {
  const breached = rule.check(metrics, raw);
  const existing = await getAlertByType(userId, rule.type);

  if (breached) {
    if (!existing) {
      // Create new alert
      await createAlert(
        userId,
        rule.type,
        rule.severity,
        rule.title,
        rule.getMessage(metrics, raw),
        rule.getMetricValue(metrics),
        rule.threshold,
      );
      logger.info({ userId, alertType: rule.type }, 'Health alert created');
    }
    // else: alert already active — leave it
  } else {
    if (existing) {
      // Metric recovered — increment ok counter, resolve after 2 consecutive
      const okCount = await incrementAlertOk(existing.id);
      if (okCount >= 2) {
        await resolveAlert(existing.id);
        logger.info({ userId, alertType: rule.type }, 'Health alert auto-resolved');
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function evaluateAlerts(
  userId: string,
  metrics: ComputedMetrics,
  extra: { capi_configured: boolean; days_since_audit: number | null },
): Promise<void> {
  const raw: RawMetrics = { ...metrics, ...extra };

  // Evaluate rules sequentially to avoid race conditions on the same alert type
  for (const rule of ALERT_RULES) {
    try {
      await evaluateRule(userId, rule, metrics, raw);
    } catch (err) {
      logger.error({ err, userId, alertType: rule.type }, 'Alert rule evaluation failed');
    }
  }
}
