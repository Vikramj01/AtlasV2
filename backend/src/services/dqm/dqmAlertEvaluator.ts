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

export interface SgtmAlertInput {
  // Worst status across all of the org's verified sGTM endpoints. One alert
  // per org (matching GTG's existing granularity) rather than per client —
  // per-client checks are still stored individually in dqm_sgtm_checks, this
  // just aggregates them into a single alert to avoid extending the shared
  // health_alerts schema (used by every other alert type) for one feature.
  worstStatus: GTGStatus;
  failingCount: number;
  totalCount: number;
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

// ── sGTM evaluation ───────────────────────────────────────────────────────────

export function evaluateSgtmAlert(input: SgtmAlertInput): AlertEvalResult {
  const { worstStatus, failingCount, totalCount, existingAlertActive } = input;

  // No verified sGTM endpoints for this org — nothing to monitor, resolve any
  // stale alert (e.g. the last verified endpoint was removed).
  if (totalCount === 0) {
    if (existingAlertActive) return { decision: 'resolve', severity: null, title: '', message: '' };
    return { decision: 'none', severity: null, title: '', message: '' };
  }

  const plural = totalCount !== 1;

  if (worstStatus === 'fail' || worstStatus === 'timeout') {
    const message = `${failingCount} of ${totalCount} verified server-side GTM endpoint${plural ? 's are' : ' is'} unreachable. Server-side tracking data may be lost for affected clients.`;
    return existingAlertActive
      ? { decision: 'update', severity: 'critical', title: 'Server-side GTM Unreachable', message }
      : { decision: 'open', severity: 'critical', title: 'Server-side GTM Unreachable', message };
  }

  if (worstStatus === 'degraded') {
    const message = `${failingCount} of ${totalCount} verified server-side GTM endpoint${plural ? 's are' : ' is'} responding slowly, above the latency threshold. This may indicate a server-side performance issue.`;
    return existingAlertActive
      ? { decision: 'update', severity: 'warning', title: 'Server-side GTM Responding Slowly', message }
      : { decision: 'open', severity: 'warning', title: 'Server-side GTM Responding Slowly', message };
  }

  // pass or error (error = probe couldn't run, not a true failure) for all endpoints
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

// ── Google delivery confirmation evaluation (Sprint 8, C8 delivery confirmation) ─
//
// Unlike GTG/DMA/sGTM (a recurring per-org probe with a "current state"),
// this fires once per finalized requestStatus:retrieve confirmation — each
// live CAPI event or offline batch that Atlas actually sent to Google. There
// is no natural "current state" to re-poll on a schedule, so the same
// open/update/resolve shape is driven by each confirmation outcome instead:
// a confirmed failure/partial opens or refreshes one rolled-up per-org
// alert (never one alert per event — that would flood health_alerts), and a
// confirmed success feeds the same consecutive-ok/resolve path the caller
// already uses for GTG/DMA/sGTM. poll_exhausted deliberately reports 'none'
// either way — running out of bounded polling attempts while Google was
// still PROCESSING is not evidence of failure, so it neither opens nor
// counts toward resolving an alert.

export type GoogleDeliveryConfirmationOutcome =
  | 'confirmed_success'
  | 'confirmed_partial'
  | 'confirmed_failed'
  | 'poll_exhausted';

export interface GoogleDeliveryAlertInput {
  outcome: GoogleDeliveryConfirmationOutcome;
  reasons: string[]; // error/warning reason strings from DMARequestStatusPerDestination, for the alert message
  existingAlertActive: boolean;
}

export function evaluateGoogleDeliveryAlert(input: GoogleDeliveryAlertInput): AlertEvalResult {
  const { outcome, reasons, existingAlertActive } = input;

  if (outcome === 'poll_exhausted') {
    return { decision: 'none', severity: null, title: '', message: '' };
  }

  if (outcome === 'confirmed_failed') {
    const reasonList = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
    const message = `Google confirmed a conversion delivery failure${reasonList}. This event was submitted successfully but rejected during processing — it will not appear in Google Ads/GA4.`;
    return existingAlertActive
      ? { decision: 'update', severity: 'critical', title: 'Google Delivery Confirmed Failed', message }
      : { decision: 'open', severity: 'critical', title: 'Google Delivery Confirmed Failed', message };
  }

  if (outcome === 'confirmed_partial') {
    const reasonList = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
    const message = `Google confirmed a partial delivery failure${reasonList} — some records in a batch were rejected during processing while others succeeded.`;
    return existingAlertActive
      ? { decision: 'update', severity: 'warning', title: 'Google Delivery Partially Confirmed', message }
      : { decision: 'open', severity: 'warning', title: 'Google Delivery Partially Confirmed', message };
  }

  // confirmed_success
  if (existingAlertActive) {
    return { decision: 'resolve', severity: null, title: '', message: '' };
  }
  return { decision: 'none', severity: null, title: '', message: '' };
}
