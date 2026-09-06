// Klaviyo ingestion connector for Auto-insight Reporter — the first email
// platform (Ecommerce Signal Completeness PRD, Feature 2).
// Pulls account-level send/open/click/revenue metrics for yesterday via
// Klaviyo's Query Metric Aggregates API. Writes to air_metric_snapshots,
// the exact same table/shape Meta/Google/GA4/LinkedIn write to, so
// anomalyDetector.ts/correlationEngine.ts/narratorService.ts need no
// per-source special-casing.
//
// Auth: reuses resolveTokens() against a platform_connections row with
// platform='klaviyo'. Klaviyo uses a private API key (no OAuth token
// exchange/refresh), so tokens.access_token holds that key directly —
// see connections.ts's POST /api/connections/klaviyo for how the row
// gets created.
//
// Design decisions:
// - Metric IDs (Placed Order / Received Email / Opened Email / Clicked
//   Email) are account-specific in Klaviyo's API, resolved by name via
//   GET /api/metrics/ on every run rather than cached — four lightweight
//   GETs per org per day is cheap, and caching them (e.g. in
//   platform_connections.metadata) is unwarranted complexity for a v1
//   connector that runs once daily.
// - A metric that fails to resolve (the account has never fired that
//   Klaviyo event — e.g. no "Placed Order" integration configured) is
//   skipped entirely, not written as a zero. A resolved metric returning
//   zero for today is real data; a metric Klaviyo doesn't track at all
//   isn't the same thing, and writing it as zero would corrupt the
//   anomaly detector's trailing-mean baseline for a series that never
//   actually existed.
// - Account-level only (dimension = null) for v1, unlike Meta/LinkedIn's
//   per-campaign breakdown — Klaviyo's per-campaign/flow grouping (the
//   `by: ['$message']` parameter) is a reasonable fast-follow, not
//   required to satisfy the PRD's "sends/opens/clicks/conversions" ask.
// - "Opens" is included per the PRD's own "opens where reliable" phrasing
//   acknowledging Apple Mail Privacy Protection inflates open counts;
//   still tracked as its own series since anomaly detection is relative
//   to its own trailing baseline, not an absolute truth claim.

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';
import { AirMetricRow, yesterday, writeMetricRows } from '@/services/air/ingestion/airIngestionUtils';

const KLAVIYO_API_BASE = 'https://a.klaviyo.com/api';
// Pin a dated revision deliberately — Klaviyo's API is revision-versioned
// and bumping this is a conscious upgrade, not an accidental drift.
const KLAVIYO_REVISION = '2025-04-15';

const KLAVIYO_METRIC_NAMES = ['Placed Order', 'Received Email', 'Opened Email', 'Clicked Email'] as const;
type KlaviyoMetricName = typeof KLAVIYO_METRIC_NAMES[number];

function klaviyoHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'revision': KLAVIYO_REVISION,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

interface KlaviyoDailyMetrics {
  sends: number | null;
  opens: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
}

// Resolves a Klaviyo metric's account-specific ID by its display name.
// Returns null if the account has never recorded that event (no such
// metric exists for it) — distinct from a resolved metric with zero volume.
export async function resolveKlaviyoMetricId(apiKey: string, metricName: KlaviyoMetricName): Promise<string | null> {
  const url = `${KLAVIYO_API_BASE}/metrics/?filter=${encodeURIComponent(`equals(name,"${metricName}")`)}`;
  const res = await fetch(url, { headers: klaviyoHeaders(apiKey) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Klaviyo Metrics API error (${res.status}): ${body}`);
  }

  const json = await res.json() as { data?: { id: string }[] };
  return json.data?.[0]?.id ?? null;
}

// Sums a measurement's date-bucketed values across every dimension bucket
// the aggregate response returned (normally a single bucket, since this
// connector never groups by `by` and the filter window is exactly one day).
function sumMeasurement(
  aggregate: { data?: { dimensions: string[]; measurements: Record<string, number[]> }[] } | undefined,
  stat: 'count' | 'sum_value' | 'unique',
): number {
  let total = 0;
  for (const bucket of aggregate?.data ?? []) {
    for (const v of bucket.measurements[stat] ?? []) total += v;
  }
  return total;
}

// Fetches one metric's count/sum_value/unique for a single UTC day.
export async function fetchKlaviyoMetricAggregate(
  apiKey: string,
  metricId: string,
  date: string,
): Promise<{ count: number; sum_value: number; unique: number }> {
  const start = `${date}T00:00:00+00:00`;
  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endIso = nextDay.toISOString().replace('.000Z', '+00:00');

  const res = await fetch(`${KLAVIYO_API_BASE}/metric-aggregates/`, {
    method: 'POST',
    headers: klaviyoHeaders(apiKey),
    body: JSON.stringify({
      data: {
        type: 'metric-aggregate',
        attributes: {
          metric_id: metricId,
          measurements: ['count', 'sum_value', 'unique'],
          filter: [
            `greater-or-equal(datetime,${start})`,
            `less-than(datetime,${endIso})`,
          ],
          interval: 'day',
          timezone: 'UTC',
          page_size: 500,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Klaviyo Metric Aggregates API error (${res.status}): ${body}`);
  }

  const json = await res.json() as {
    data?: { attributes?: { data?: { dimensions: string[]; measurements: Record<string, number[]> }[] } };
  };
  const attrs = json.data?.attributes;

  return {
    count: sumMeasurement(attrs, 'count'),
    sum_value: sumMeasurement(attrs, 'sum_value'),
    unique: sumMeasurement(attrs, 'unique'),
  };
}

// Fetches all four Klaviyo metrics for one account on a given day, skipping
// any metric the account has never recorded (see module doc for rationale).
export async function fetchKlaviyoDailyMetrics(apiKey: string, date: string): Promise<KlaviyoDailyMetrics> {
  const [placedOrderId, receivedEmailId, openedEmailId, clickedEmailId] = await Promise.all(
    KLAVIYO_METRIC_NAMES.map((name) => resolveKlaviyoMetricId(apiKey, name)),
  );

  const [placedOrder, receivedEmail, openedEmail, clickedEmail] = await Promise.all([
    placedOrderId ? fetchKlaviyoMetricAggregate(apiKey, placedOrderId, date) : null,
    receivedEmailId ? fetchKlaviyoMetricAggregate(apiKey, receivedEmailId, date) : null,
    openedEmailId ? fetchKlaviyoMetricAggregate(apiKey, openedEmailId, date) : null,
    clickedEmailId ? fetchKlaviyoMetricAggregate(apiKey, clickedEmailId, date) : null,
  ]);

  return {
    sends: receivedEmail ? receivedEmail.count : null,
    opens: openedEmail ? openedEmail.unique : null,
    clicks: clickedEmail ? clickedEmail.unique : null,
    conversions: placedOrder ? placedOrder.count : null,
    revenue: placedOrder ? placedOrder.sum_value : null,
  };
}

// Converts daily metrics into flat AirMetricRow entries. Account-level only
// (dimension = null) — see module doc.
export function buildKlaviyoMetricRows(orgId: string, metrics: KlaviyoDailyMetrics, date: string): AirMetricRow[] {
  const out: AirMetricRow[] = [];
  const push = (metric_name: string, value: number | null) => {
    if (value !== null) out.push({ org_id: orgId, source: 'klaviyo', metric_name, dimension: null, value, snapshot_date: date });
  };

  push('sends', metrics.sends);
  push('opens', metrics.opens);
  push('clicks', metrics.clicks);
  push('conversions', metrics.conversions);
  push('revenue', metrics.revenue);

  return out;
}

// Entry point called by the ingestion orchestrator.
export async function ingestKlaviyo(orgId: string, date = yesterday()): Promise<void> {
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id')
    .eq('organization_id', orgId)
    .eq('platform', 'klaviyo')
    .in('status', ['active', 'connected']);

  if (connErr) throw new Error(`Failed to query platform_connections: ${connErr.message}`);
  if (!connections || connections.length === 0) {
    logger.info({ orgId }, 'AIR/klaviyo: no active connections — skipping');
    return;
  }

  type ConnRow = { id: string };
  const allRows: AirMetricRow[] = [];

  for (const conn of connections as ConnRow[]) {
    try {
      const tokens = await resolveTokens(conn.id);
      const metrics = await fetchKlaviyoDailyMetrics(tokens.access_token, date);
      const metricRows = buildKlaviyoMetricRows(orgId, metrics, date);
      allRows.push(...metricRows);
      logger.info({ orgId, connectionId: conn.id, metrics: metricRows.length }, 'AIR/klaviyo: fetched');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, connectionId: conn.id }, 'AIR/klaviyo: connection fetch failed');
    }
  }

  await writeMetricRows(allRows);
}
