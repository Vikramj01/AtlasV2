// AIR anomaly detector.
// Fetches 14 days of air_metric_snapshots for an org in a single query,
// groups by metric series in memory, computes a trailing mean baseline,
// and writes anomalies to air_anomalies when deviation_pct exceeds a threshold.
//
// Design decisions:
// - One DB read + one DB write per org (avoids N+1 per metric series).
// - MIN_BASELINE_POINTS = 7: require a full week before flagging anomalies
//   to avoid false positives on new connections with sparse history.
// - baseline_value = 0 guard: skip series where the mean baseline is zero
//   (division by zero; also means the metric hasn't had any value before).
// - Rates (bounce_rate, engagement_rate, ctr) behave differently from volume
//   metrics but use the same threshold — adequate for MVP.

import { supabaseAdmin } from '@/services/database/supabase';
import { getAirEligibleOrgIds } from '@/services/air/ingestion/ingestionOrchestrator';
import logger from '@/utils/logger';

const BASELINE_WINDOW_DAYS = 14;
const MIN_BASELINE_POINTS = 7;

// Absolute deviation_pct thresholds for severity classification.
const SEVERITY_THRESHOLDS = { high: 50, medium: 30, low: 15 } as const;

export interface AnomalyRow {
  org_id: string;
  source: 'google_ads' | 'meta_ads' | 'ga4';
  metric_name: string;
  dimension: string | null;
  detected_date: string;
  baseline_value: number;
  observed_value: number;
  deviation_pct: number;
  severity: 'low' | 'medium' | 'high';
}

export function classifySeverity(absPct: number): 'low' | 'medium' | 'high' | null {
  if (absPct >= SEVERITY_THRESHOLDS.high)   return 'high';
  if (absPct >= SEVERITY_THRESHOLDS.medium) return 'medium';
  if (absPct >= SEVERITY_THRESHOLDS.low)    return 'low';
  return null;
}

// Returns YYYY-MM-DD for `date` minus `days` calendar days.
export function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}

// Groups raw snapshot rows into per-series buckets:
// { observed: number | null, baseline: number[] }
// Internal key: "source|metric_name|dimension" (null dimension → "__null__")
interface SeriesBucket {
  source: string;
  metricName: string;
  dimension: string | null;
  observed: number | null;
  baseline: number[];
}

export function groupIntoSeries(
  snapshots: { source: string; metric_name: string; dimension: string | null; value: number; snapshot_date: string }[],
  detectedDate: string,
): Map<string, SeriesBucket> {
  const map = new Map<string, SeriesBucket>();

  for (const row of snapshots) {
    const dimKey = row.dimension ?? '__null__';
    const key = `${row.source}|${row.metric_name}|${dimKey}`;

    if (!map.has(key)) {
      map.set(key, {
        source: row.source,
        metricName: row.metric_name,
        dimension: row.dimension,
        observed: null,
        baseline: [],
      });
    }

    const bucket = map.get(key)!;
    if (row.snapshot_date === detectedDate) {
      bucket.observed = row.value;
    } else {
      bucket.baseline.push(row.value);
    }
  }

  return map;
}

// Pure function: given grouped series, returns anomaly rows above threshold.
export function detectAnomalies(
  orgId: string,
  seriesMap: Map<string, SeriesBucket>,
  detectedDate: string,
): AnomalyRow[] {
  const anomalies: AnomalyRow[] = [];

  for (const bucket of seriesMap.values()) {
    if (bucket.observed === null) continue;
    if (bucket.baseline.length < MIN_BASELINE_POINTS) continue;

    const baselineMean =
      bucket.baseline.reduce((acc, v) => acc + v, 0) / bucket.baseline.length;

    if (baselineMean === 0) continue;

    const deviationPct = ((bucket.observed - baselineMean) / baselineMean) * 100;
    const severity = classifySeverity(Math.abs(deviationPct));
    if (!severity) continue;

    anomalies.push({
      org_id: orgId,
      source: bucket.source as AnomalyRow['source'],
      metric_name: bucket.metricName,
      dimension: bucket.dimension,
      detected_date: detectedDate,
      baseline_value: Math.round(baselineMean * 10000) / 10000,
      observed_value: bucket.observed,
      deviation_pct: Math.round(deviationPct * 100) / 100,
      severity,
    });
  }

  return anomalies;
}

// Entry point: runs anomaly detection for one org on a given date.
// Fetches the trailing 14-day window in a single query, detects anomalies
// in memory, and upserts results to air_anomalies.
export async function runAnomalyDetectionForOrg(
  orgId: string,
  date: string,
): Promise<void> {
  const windowStart = subtractDays(date, BASELINE_WINDOW_DAYS);

  const { data: snapshots, error: fetchErr } = await supabaseAdmin
    .from('air_metric_snapshots')
    .select('source, metric_name, dimension, value, snapshot_date')
    .eq('org_id', orgId)
    .gte('snapshot_date', windowStart)
    .lte('snapshot_date', date);

  if (fetchErr) throw new Error(`AIR anomaly: failed to fetch snapshots: ${fetchErr.message}`);
  if (!snapshots || snapshots.length === 0) {
    logger.info({ orgId, date }, 'AIR anomaly: no snapshot data — skipping');
    return;
  }

  type SnapshotRow = { source: string; metric_name: string; dimension: string | null; value: number; snapshot_date: string };
  const seriesMap = groupIntoSeries(snapshots as SnapshotRow[], date);
  const anomalies = detectAnomalies(orgId, seriesMap, date);

  if (anomalies.length === 0) {
    logger.info({ orgId, date }, 'AIR anomaly: no anomalies detected');
    return;
  }

  const { error: upsertErr } = await (supabaseAdmin
    .from('air_anomalies') as unknown as {
      upsert: (
        rows: AnomalyRow[],
        opts: { onConflict: string },
      ) => Promise<{ error: { message: string } | null }>;
    })
    .upsert(anomalies, { onConflict: 'org_id,source,metric_name,dimension,detected_date' });

  if (upsertErr) throw new Error(`AIR anomaly: upsert failed: ${upsertErr.message}`);

  logger.info({ orgId, date, detected: anomalies.length }, 'AIR anomaly detection: complete');
}

// Fan-out: runs anomaly detection for all eligible orgs on the given date.
export async function runAnomalyDetectionForAllActiveOrgs(date: string): Promise<void> {
  const orgIds = await getAirEligibleOrgIds();
  logger.info({ count: orgIds.length, date }, 'AIR anomaly: running for eligible orgs');

  for (const orgId of orgIds) {
    try {
      await runAnomalyDetectionForOrg(orgId, date);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), orgId },
        'AIR anomaly: per-org failure',
      );
    }
  }
}
