// AIR correlation engine.
// For each anomaly on a given date, searches four Atlas-internal signal sources
// within a ±3-day window and writes matches to air_insight_correlations.
//
// Design decisions:
// - Pure helpers (buildWindowDates, computeProximityDays, computeConfidence, addDays)
//   are exported for isolated unit testing.
// - andromeda_score_drop: health_* tables are user_id-keyed. We resolve org_id →
//   user_ids via profiles, then query health_snapshots where overall_score drops
//   below SCORE_DROP_THRESHOLD (70). Snapshots above threshold are noise.
// - Idempotent re-run: delete existing correlation rows for the anomaly set before
//   inserting fresh ones. No UNIQUE constraint exists on the table, so DELETE+INSERT
//   is the clean reset approach.
// - One cross-product write: factors are fetched once per org+date then fanned out
//   across all anomaly IDs (N anomalies × M factors = N×M rows, one insert batch).

import { supabaseAdmin } from '@/services/database/supabase';
import { getAirEligibleOrgIds } from '@/services/air/ingestion/ingestionOrchestrator';
import { subtractDays } from '@/services/air/anomalyDetector';
import logger from '@/utils/logger';

const CORRELATION_WINDOW_DAYS = 3;
const SCORE_DROP_THRESHOLD = 70;

export type FactorType =
  | 'dqm_alert'
  | 'cse_signal_change'
  | 'andromeda_score_drop'
  | 'bse_delivery_failure';

export interface CorrelationRow {
  anomaly_id: string;
  factor_type: FactorType;
  factor_ref_id: string | null;
  factor_date: string;
  proximity_days: number;
  confidence_score: number;
}

// Adds `days` calendar days to a YYYY-MM-DD date string.
export function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Returns the inclusive [windowStart, windowEnd] window as YYYY-MM-DD strings.
export function buildWindowDates(date: string): { windowStart: string; windowEnd: string } {
  return {
    windowStart: subtractDays(date, CORRELATION_WINDOW_DAYS),
    windowEnd: addDays(date, CORRELATION_WINDOW_DAYS),
  };
}

// Absolute calendar-day distance between two YYYY-MM-DD dates.
export function computeProximityDays(detectedDate: string, factorDate: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = new Date(factorDate).getTime() - new Date(detectedDate).getTime();
  return Math.abs(Math.round(diff / msPerDay));
}

// Linear-decay confidence: 1.0 at day 0, 0.75 at day 1, 0.50 at day 2, 0.25 at day 3+.
export function computeConfidence(proximityDays: number): number {
  return Math.round(Math.max(0.25, 1.0 - proximityDays * 0.25) * 100) / 100;
}

// Queries all four factor sources in the ±CORRELATION_WINDOW_DAYS window.
// Returns correlation rows without anomaly_id (caller fans out over anomaly set).
export async function fetchCorrelationFactors(
  orgId: string,
  detectedDate: string,
): Promise<Omit<CorrelationRow, 'anomaly_id'>[]> {
  const { windowStart, windowEnd } = buildWindowDates(detectedDate);
  const windowEndTs = windowEnd + 'T23:59:59Z';
  const out: Omit<CorrelationRow, 'anomaly_id'>[] = [];

  // ── 1. dqm_alert: failed GTG checks ──────────────────────────────────────
  const { data: dqmRows } = await supabaseAdmin
    .from('dqm_gtg_checks')
    .select('id, checked_at')
    .eq('org_id', orgId)
    .eq('check_status', 'fail')
    .gte('checked_at', windowStart)
    .lte('checked_at', windowEndTs);

  for (const row of (dqmRows ?? []) as { id: string; checked_at: string }[]) {
    const factorDate = row.checked_at.split('T')[0];
    const prox = computeProximityDays(detectedDate, factorDate);
    out.push({ factor_type: 'dqm_alert', factor_ref_id: row.id, factor_date: factorDate, proximity_days: prox, confidence_score: computeConfidence(prox) });
  }

  // ── 2. cse_signal_change: completed crawl runs ────────────────────────────
  const { data: crawlRows } = await supabaseAdmin
    .from('crawl_runs')
    .select('id, created_at')
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .gte('created_at', windowStart)
    .lte('created_at', windowEndTs);

  for (const row of (crawlRows ?? []) as { id: string; created_at: string }[]) {
    const factorDate = row.created_at.split('T')[0];
    const prox = computeProximityDays(detectedDate, factorDate);
    out.push({ factor_type: 'cse_signal_change', factor_ref_id: row.id, factor_date: factorDate, proximity_days: prox, confidence_score: computeConfidence(prox) });
  }

  // ── 3. andromeda_score_drop: health score below threshold ─────────────────
  // health_snapshots is user_id-keyed; resolve org_id → user_ids via profiles.
  const { data: profileRows } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId);

  const userIds = (profileRows ?? []).map((p: { id: string }) => p.id);

  if (userIds.length > 0) {
    const { data: snapRows } = await supabaseAdmin
      .from('health_snapshots')
      .select('id, snapshot_at')
      .in('user_id', userIds)
      .lt('overall_score', SCORE_DROP_THRESHOLD)
      .gte('snapshot_at', windowStart)
      .lte('snapshot_at', windowEndTs);

    for (const row of (snapRows ?? []) as { id: string; snapshot_at: string }[]) {
      const factorDate = row.snapshot_at.split('T')[0];
      const prox = computeProximityDays(detectedDate, factorDate);
      out.push({ factor_type: 'andromeda_score_drop', factor_ref_id: row.id, factor_date: factorDate, proximity_days: prox, confidence_score: computeConfidence(prox) });
    }
  }

  // ── 4. bse_delivery_failure: failed enricher runs ─────────────────────────
  const { data: enricherRows } = await supabaseAdmin
    .from('enricher_runs')
    .select('id, created_at')
    .eq('org_id', orgId)
    .eq('status', 'failed')
    .gte('created_at', windowStart)
    .lte('created_at', windowEndTs);

  for (const row of (enricherRows ?? []) as { id: string; created_at: string }[]) {
    const factorDate = row.created_at.split('T')[0];
    const prox = computeProximityDays(detectedDate, factorDate);
    out.push({ factor_type: 'bse_delivery_failure', factor_ref_id: row.id, factor_date: factorDate, proximity_days: prox, confidence_score: computeConfidence(prox) });
  }

  return out;
}

// Runs correlation for all anomalies detected for one org on a given date.
export async function runCorrelationForOrg(orgId: string, date: string): Promise<void> {
  const { data: anomalies, error: fetchErr } = await supabaseAdmin
    .from('air_anomalies')
    .select('id')
    .eq('org_id', orgId)
    .eq('detected_date', date);

  if (fetchErr) throw new Error(`AIR correlation: failed to fetch anomalies: ${fetchErr.message}`);
  if (!anomalies || anomalies.length === 0) {
    logger.info({ orgId, date }, 'AIR correlation: no anomalies to correlate');
    return;
  }

  const factors = await fetchCorrelationFactors(orgId, date);
  const anomalyIds = (anomalies as { id: string }[]).map((a) => a.id);

  // Delete stale correlations for this anomaly set before re-inserting.
  await supabaseAdmin
    .from('air_insight_correlations')
    .delete()
    .in('anomaly_id', anomalyIds);

  if (factors.length === 0) {
    logger.info({ orgId, date }, 'AIR correlation: no factors found in window');
    return;
  }

  // Cross-product: every anomaly gets every factor.
  const rows: CorrelationRow[] = [];
  for (const anomaly of anomalies as { id: string }[]) {
    for (const factor of factors) {
      rows.push({ anomaly_id: anomaly.id, ...factor });
    }
  }

  const { error: insertErr } = await supabaseAdmin
    .from('air_insight_correlations')
    .insert(rows);

  if (insertErr) throw new Error(`AIR correlation: insert failed: ${insertErr.message}`);

  logger.info({ orgId, date, anomalies: anomalies.length, correlations: rows.length }, 'AIR correlation: complete');
}

// Fan-out: runs correlation for all eligible orgs on the given date.
export async function runCorrelationForAllActiveOrgs(date: string): Promise<void> {
  const orgIds = await getAirEligibleOrgIds();
  logger.info({ count: orgIds.length, date }, 'AIR correlation: running for eligible orgs');

  for (const orgId of orgIds) {
    try {
      await runCorrelationForOrg(orgId, date);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), orgId },
        'AIR correlation: per-org failure',
      );
    }
  }
}
