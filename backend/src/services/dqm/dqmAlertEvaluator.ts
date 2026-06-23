// DQM Alert Evaluator — pure function, no side effects, no DB calls.
// Takes a probe result + context and returns an alert decision.
// Kept separate from probe services so severity thresholds are unit-testable in isolation.

import type { AlertSeverity } from '@/types/health';

export type GTGStatus = 'pass' | 'degraded' | 'fail' | 'timeout' | 'error' | 'skipped-backoff';
export type DMAStatus = 'ok' | 'warning' | 'critical' | 'skipped-backoff';

export type AlertDecision = 'none' | 'open' | 'update' | 'resolve';

export interface GTGAlertInput {
  status: GTGStatus;
  existingAlertActive: boolean;
}

export interface DMAAlertInput {
  uploadSuccessRate: number;          // 0–100
  avgMatchRate: number | null;
  prevAvgMatchRate: number | null;    // trailing value to detect drops; null = no history
  totalMembers30d: number;
  hadActivityBefore: boolean;         // true if we've seen non-zero members previously
  matchRateWarningThreshold: number;  // absolute floor, e.g. 0.50 → 50%
  matchRateDropThreshold: number;     // relative drop that triggers warning, e.g. 0.10 → 10pp
  existingAlertActive: boolean;
}

export interface AlertEvalResult {
  decision: AlertDecision;
  severity: AlertSeverity | null;
  title: string;
  message: string;
}

// ── GTG evaluation ────────────────────────────────────────────────────────────

export function evaluateGTGAlert(input: GTGAlertInput): AlertEvalResult {
  const { status, existingAlertActive } = input;

  // Backoff-skip is expected behaviour — never open or update an alert for it.
  if (status === 'skipped-backoff') {
    return { decision: 'none', severity: null, title: '', message: '' };
  }

  if (status === 'fail' || status === 'timeout') {
    if (existingAlertActive) {
      return {
        decision: 'update',
        severity: 'critical',
        title: 'GTG Path Unavailable',
        message: `Your Google Tag (GTG) path is returning ${status === 'timeout' ? 'no response (timeout)' : 'a failure response'}. First-party tracking data may be lost.`,
      };
    }
    return {
      decision: 'open',
      severity: 'critical',
      title: 'GTG Path Unavailable',
      message: `Your Google Tag (GTG) path is returning ${status === 'timeout' ? 'no response (timeout)' : 'a failure response'}. First-party tracking data may be lost.`,
    };
  }

  if (status === 'degraded') {
    if (existingAlertActive) {
      return {
        decision: 'update',
        severity: 'warning',
        title: 'GTG Path Responding Slowly',
        message: 'Your Google Tag (GTG) path is responding, but latency is above the 2s threshold. This may indicate a server-side performance issue.',
      };
    }
    return {
      decision: 'open',
      severity: 'warning',
      title: 'GTG Path Responding Slowly',
      message: 'Your Google Tag (GTG) path is responding, but latency is above the 2s threshold. This may indicate a server-side performance issue.',
    };
  }

  // pass or error (error = no GTM connection, not a true failure)
  if (existingAlertActive) {
    return { decision: 'resolve', severity: null, title: '', message: '' };
  }
  return { decision: 'none', severity: null, title: '', message: '' };
}

// ── DMA evaluation ────────────────────────────────────────────────────────────

export function evaluateDMAAlert(input: DMAAlertInput): AlertEvalResult {
  const {
    uploadSuccessRate,
    avgMatchRate,
    prevAvgMatchRate,
    totalMembers30d,
    hadActivityBefore,
    matchRateWarningThreshold,
    matchRateDropThreshold,
    existingAlertActive,
  } = input;

  // Complete upload failure after previous activity → critical
  if (hadActivityBefore && uploadSuccessRate === 0 && totalMembers30d === 0) {
    const msg = 'DMA upload activity has stopped. No audience members have been uploaded in the last 30 days despite previous activity.';
    return existingAlertActive
      ? { decision: 'update', severity: 'critical', title: 'DMA Upload Activity Stopped', message: msg }
      : { decision: 'open',   severity: 'critical', title: 'DMA Upload Activity Stopped', message: msg };
  }

  // Absolute match rate below warning floor → warning
  const matchRateFloorPct = matchRateWarningThreshold * 100;
  if (avgMatchRate !== null && avgMatchRate < matchRateFloorPct) {
    const msg = `DMA average match rate is ${avgMatchRate.toFixed(1)}%, below the ${matchRateFloorPct.toFixed(0)}% threshold. Audience reach may be significantly reduced.`;
    return existingAlertActive
      ? { decision: 'update', severity: 'warning', title: 'DMA Match Rate Below Threshold', message: msg }
      : { decision: 'open',   severity: 'warning', title: 'DMA Match Rate Below Threshold', message: msg };
  }

  // Match rate dropped more than the configured threshold vs. previous reading → warning
  if (
    avgMatchRate !== null &&
    prevAvgMatchRate !== null &&
    prevAvgMatchRate > 0
  ) {
    const dropPct = (prevAvgMatchRate - avgMatchRate) / prevAvgMatchRate;
    if (dropPct >= matchRateDropThreshold) {
      const msg = `DMA match rate has dropped ${(dropPct * 100).toFixed(1)} percentage points (from ${prevAvgMatchRate.toFixed(1)}% to ${avgMatchRate.toFixed(1)}%). Investigate audience quality or data mapping issues.`;
      return existingAlertActive
        ? { decision: 'update', severity: 'warning', title: 'DMA Match Rate Drop Detected', message: msg }
        : { decision: 'open',   severity: 'warning', title: 'DMA Match Rate Drop Detected', message: msg };
    }
  }

  // All thresholds healthy → resolve any open alert
  if (existingAlertActive) {
    return { decision: 'resolve', severity: null, title: '', message: '' };
  }
  return { decision: 'none', severity: null, title: '', message: '' };
}
