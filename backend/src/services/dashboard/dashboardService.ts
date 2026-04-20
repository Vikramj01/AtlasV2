/**
 * Dashboard Service — aggregates data from CAPI, audit, signal, and developer
 * portal tables to produce prioritised DashboardCard[] for the action dashboard.
 *
 * Thresholds (from PRD Section 5 / metric guidance spec):
 *   EMQ:                  < 6.0 → critical  |  6.0–8.0 → warning
 *   CAPI delivery rate:   < 75% → critical  |  75–90%  → warning
 *   Signal coverage:      < 50% → critical  |  50–70%  → warning
 *   Audit score:          < 50% → critical  |  50–65%  → warning
 *   Consent rate:         < 50% → warning
 *   Impl progress:        < 70% → warning
 */

import { supabaseAdmin as supabase } from '@/services/database/supabase';
import type {
  DashboardCard,
  DashboardResponse,
  DashboardSummary,
  CardSeverity,
  OverallHealth,
} from '@/types/dashboard';

const SEVERITY_ORDER: Record<CardSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  success: 3,
};

function sortCards(cards: DashboardCard[]): DashboardCard[] {
  return [...cards].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function overallHealth(cards: DashboardCard[]): OverallHealth {
  if (cards.some((c) => c.severity === 'critical')) return 'critical';
  if (cards.some((c) => c.severity === 'warning')) return 'attention';
  return 'healthy';
}

// ── CAPI metrics ──────────────────────────────────────────────────────────────
// Use health_scores.capi_delivery_rate — already user-scoped and computed by
// the health orchestrator from the user's own CAPI providers.

async function getCAPIMetrics(
  userId: string,
): Promise<{ deliveryPct: number | null; avgEmq: number | null; dataAt: string | null }> {
  const { data: healthScore } = await supabase
    .from('health_scores')
    .select('capi_delivery_rate, computed_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!healthScore || healthScore.capi_delivery_rate == null) {
    return { deliveryPct: null, avgEmq: null, dataAt: null };
  }

  const rate = healthScore.capi_delivery_rate as number;
  // capi_delivery_rate of 0 means "no providers connected" — treat as null
  if (rate === 0) {
    return { deliveryPct: null, avgEmq: null, dataAt: null };
  }

  return {
    deliveryPct: Math.round(rate),
    avgEmq: null,
    dataAt: healthScore.computed_at as string,
  };
}

// ── Audit metrics ─────────────────────────────────────────────────────────────

async function getAuditMetrics(
  userId: string,
): Promise<{ score: number | null; prevScore: number | null; lastAuditAt: string | null }> {
  const { data: audits } = await supabase
    .from('audits')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(2);

  if (!audits || audits.length === 0) {
    return { score: null, prevScore: null, lastAuditAt: null };
  }

  // Fetch health score (computed by healthOrchestrator and stored in health_scores)
  const { data: healthScore } = await supabase
    .from('health_scores')
    .select('overall_score, signal_health, computed_at')
    .eq('user_id', userId)
    .maybeSingle();

  const score = healthScore ? (healthScore.overall_score as number) : null;
  const lastAuditAt = healthScore
    ? (healthScore.computed_at as string)
    : (audits[0].created_at as string);

  // Get previous snapshot for delta
  const { data: snapshots } = await supabase
    .from('health_snapshots')
    .select('overall_score')
    .eq('user_id', userId)
    .order('snapshot_at', { ascending: false })
    .limit(2);

  const prevScore =
    snapshots && snapshots.length > 1
      ? (snapshots[1].overall_score as number)
      : null;

  return { score, prevScore, lastAuditAt };
}

// ── Signal coverage ───────────────────────────────────────────────────────────

async function getSignalCoverage(
  userId: string,
): Promise<{ coveragePct: number | null; dataAt: string | null }> {
  // Use the signal_health field from health_scores as a proxy for coverage
  const { data: healthScore } = await supabase
    .from('health_scores')
    .select('signal_health, computed_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!healthScore || healthScore.signal_health == null) {
    return { coveragePct: null, dataAt: null };
  }

  return {
    coveragePct: Math.round(healthScore.signal_health as number),
    dataAt: healthScore.computed_at as string,
  };
}

// ── Consent rate ──────────────────────────────────────────────────────────────

async function getConsentRate(
  userId: string,
): Promise<{ consentPct: number | null; dataAt: string | null }> {
  const { data: healthScore } = await supabase
    .from('health_scores')
    .select('consent_coverage, computed_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!healthScore || healthScore.consent_coverage == null) {
    return { consentPct: null, dataAt: null };
  }

  return {
    consentPct: Math.round(healthScore.consent_coverage as number),
    dataAt: healthScore.computed_at as string,
  };
}

// ── Implementation progress ───────────────────────────────────────────────────

async function getImplementationProgress(
  userId: string,
): Promise<{ progressPct: number | null; dataAt: string | null }> {
  // Get the most recent developer share for this user
  const { data: shares } = await supabase
    .from('developer_shares')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!shares || shares.length === 0) {
    return { progressPct: null, dataAt: null };
  }

  const shareId = shares[0].id as string;

  const { data: progress } = await supabase
    .from('implementation_progress')
    .select('status, updated_at')
    .eq('share_id', shareId);

  if (!progress || progress.length === 0) {
    return { progressPct: null, dataAt: shares[0].created_at as string };
  }

  const total = progress.length;
  const done = progress.filter(
    (p) => p.status === 'implemented' || p.status === 'verified',
  ).length;

  const progressPct = Math.round((done / total) * 100);
  const latestUpdate = progress
    .map((p) => p.updated_at as string)
    .sort()
    .at(-1) ?? null;

  return { progressPct, dataAt: latestUpdate };
}

// ── Card builders ─────────────────────────────────────────────────────────────

function buildCAPICards(
  deliveryPct: number | null,
  avgEmq: number | null,
  dataAt: string | null,
): DashboardCard[] {
  const cards: DashboardCard[] = [];

  if (deliveryPct !== null) {
    let severity: CardSeverity;
    let message: string;

    if (deliveryPct < 75) {
      severity = 'critical';
      message = `Only ${deliveryPct}% of conversion events are being delivered. Significant revenue data is being lost.`;
    } else if (deliveryPct < 90) {
      severity = 'warning';
      message = `CAPI delivery is at ${deliveryPct}%. Review failed events to improve coverage.`;
    } else {
      severity = 'success';
      message = `CAPI delivery is strong at ${deliveryPct}%.`;
    }

    cards.push({
      id: 'capi_delivery',
      type: 'capi_delivery',
      severity,
      title: 'Conversion API Delivery',
      message,
      metric_value: deliveryPct,
      threshold: 90,
      action_url: '/integrations/capi',
      action_label: 'View CAPI dashboard',
      data_at: dataAt,
    });
  }

  if (avgEmq !== null) {
    let severity: CardSeverity;
    let message: string;

    if (avgEmq < 6) {
      severity = 'critical';
      message = `Match quality of ${avgEmq.toFixed(1)} is below the critical threshold. Conversion matching is poor.`;
    } else if (avgEmq < 8) {
      severity = 'warning';
      message = `Match quality of ${avgEmq.toFixed(1)} can be improved. Add more customer data signals.`;
    } else {
      severity = 'success';
      message = `Match quality of ${avgEmq.toFixed(1)} is strong.`;
    }

    cards.push({
      id: 'capi_emq',
      type: 'capi_emq',
      severity,
      title: 'Meta match quality',
      message,
      metric_value: avgEmq,
      threshold: 8,
      action_url: '/integrations/capi',
      action_label: 'Improve match quality',
      data_at: dataAt,
    });
  }

  return cards;
}

function buildAuditCard(
  score: number | null,
  lastAuditAt: string | null,
): DashboardCard | null {
  if (score === null) return null;

  let severity: CardSeverity;
  let message: string;

  if (score < 50) {
    severity = 'critical';
    message = `Tracking audit score is ${score}%. Major issues detected — your conversion data may be unreliable.`;
  } else if (score < 65) {
    severity = 'warning';
    message = `Audit score of ${score}% indicates functional gaps in your tracking setup.`;
  } else {
    severity = 'success';
    message = `Tracking audit score is ${score}%. Your implementation looks healthy.`;
  }

  return {
    id: 'audit_score',
    type: 'audit_score',
    severity,
    title: 'Tracking Audit Score',
    message,
    metric_value: score,
    threshold: 65,
    action_url: '/health',
    action_label: 'View Signal Health',
    data_at: lastAuditAt,
  };
}

function buildSignalCoverageCard(
  coveragePct: number | null,
  dataAt: string | null,
): DashboardCard | null {
  if (coveragePct === null) return null;

  let severity: CardSeverity;
  let message: string;

  if (coveragePct < 50) {
    severity = 'critical';
    message = `Signal coverage is only ${coveragePct}%. You're missing critical tracking on key pages.`;
  } else if (coveragePct < 70) {
    severity = 'warning';
    message = `Signal coverage is ${coveragePct}%. There are tracking gaps worth closing.`;
  } else {
    severity = 'success';
    message = `Signal coverage is ${coveragePct}%. Most key events are being tracked.`;
  }

  return {
    id: 'signal_coverage',
    type: 'signal_coverage',
    severity,
    title: 'Signal Coverage',
    message,
    metric_value: coveragePct,
    threshold: 70,
    action_url: '/health',
    action_label: 'View Signal Health',
    data_at: dataAt,
  };
}

function buildConsentCard(
  consentPct: number | null,
  dataAt: string | null,
): DashboardCard | null {
  if (consentPct === null) return null;

  let severity: CardSeverity;
  let message: string;

  if (consentPct < 50) {
    severity = 'warning';
    message = `Only ${consentPct}% of visitors are consenting to tracking. Significant signal loss.`;
  } else {
    severity = 'info';
    message = `Consent rate is ${consentPct}%. Review your banner to increase opt-in rates.`;
  }

  return {
    id: 'consent_rate',
    type: 'consent_rate',
    severity,
    title: 'Consent Rate',
    message,
    metric_value: consentPct,
    threshold: 50,
    action_url: '/consent',
    action_label: 'Review Consent & Privacy',
    data_at: dataAt,
  };
}

function buildImplementationCard(
  progressPct: number | null,
  dataAt: string | null,
): DashboardCard | null {
  if (progressPct === null) return null;

  let severity: CardSeverity;
  let message: string;

  if (progressPct < 70) {
    severity = 'warning';
    message = `Implementation is ${progressPct}% complete. Follow up with your developer to unblock tracking.`;
  } else {
    severity = 'info';
    message = `Implementation is ${progressPct}% complete.`;
  }

  return {
    id: 'implementation_progress',
    type: 'implementation_progress',
    severity,
    title: 'Developer Implementation',
    message,
    metric_value: progressPct,
    threshold: 70,
    action_url: '/planning',
    action_label: 'View Set Up Tracking',
    data_at: dataAt,
  };
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export async function buildDashboard(userId: string): Promise<DashboardResponse> {
  const [capiMetrics, auditMetrics, signalCoverage, consentRate, implProgress] =
    await Promise.all([
      getCAPIMetrics(userId),
      getAuditMetrics(userId),
      getSignalCoverage(userId),
      getConsentRate(userId),
      getImplementationProgress(userId),
    ]);

  const rawCards: (DashboardCard | null)[] = [
    ...buildCAPICards(capiMetrics.deliveryPct, capiMetrics.avgEmq, capiMetrics.dataAt),
    buildAuditCard(auditMetrics.score, auditMetrics.lastAuditAt),
    buildSignalCoverageCard(signalCoverage.coveragePct, signalCoverage.dataAt),
    buildConsentCard(consentRate.consentPct, consentRate.dataAt),
    buildImplementationCard(implProgress.progressPct, implProgress.dataAt),
  ];

  const cards = sortCards(rawCards.filter((c): c is DashboardCard => c !== null));

  const summary: DashboardSummary = {
    overall_health: overallHealth(cards),
    signal_coverage_pct: signalCoverage.coveragePct,
    capi_delivery_pct: capiMetrics.deliveryPct,
    avg_emq: capiMetrics.avgEmq,
    implementation_progress: implProgress.progressPct,
    last_audit: auditMetrics.lastAuditAt,
  };

  return {
    summary,
    cards,
    generated_at: new Date().toISOString(),
  };
}
