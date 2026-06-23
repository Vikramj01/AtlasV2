// Google Ads ingestion connector for Auto-insight Reporter.
// Pulls campaign-level CPA, conversions, spend, impressions, and CTR for
// yesterday only (daily batch cadence). Writes to air_metric_snapshots via
// an idempotent upsert — safe to re-run if the job retries.
//
// Auth: reuses resolveTokens() from the existing platform_connections OAuth
// flow. Google Ads tokens already carry the adwords scope from the combined
// consent screen in googleAdsOAuth.ts — no re-auth needed.

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const GADS_BASE = 'https://googleads.googleapis.com/v18';

export interface AirMetricRow {
  org_id: string;
  source: 'google_ads';
  metric_name: string;
  dimension: string | null;
  value: number;
  snapshot_date: string; // YYYY-MM-DD
}

interface CampaignPerfRow {
  campaignId: string;
  campaignName: string;
  date: string;
  costMicros: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

function yesterday(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

// Calls the Google Ads searchStream endpoint for one customer account.
// Returns raw per-campaign rows for the target date.
export async function fetchCampaignPerformance(
  customerId: string,
  accessToken: string,
  date: string,
  managerId?: string,
): Promise<CampaignPerfRow[]> {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.conversions,
      metrics.impressions,
      metrics.clicks
    FROM campaign
    WHERE segments.date = '${date}'
      AND campaign.status IN ('ENABLED', 'PAUSED')
    ORDER BY metrics.cost_micros DESC
  `;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (managerId) headers['login-customer-id'] = managerId;

  const res = await fetch(`${GADS_BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${body}`);
  }

  const rows: CampaignPerfRow[] = [];
  const text = await res.text();

  for (const line of text.split('\n').filter((l) => l.trim().startsWith('{'))) {
    try {
      const parsed = JSON.parse(line) as {
        results?: {
          segments?: { date?: string };
          campaign?: { id?: string; name?: string };
          metrics?: {
            costMicros?: string;
            conversions?: string;
            impressions?: string;
            clicks?: string;
          };
        }[];
      };
      for (const r of parsed.results ?? []) {
        if (!r.campaign?.id || !r.segments?.date) continue;
        rows.push({
          campaignId: r.campaign.id,
          campaignName: r.campaign.name ?? '',
          date: r.segments.date,
          costMicros: parseFloat(r.metrics?.costMicros ?? '0'),
          conversions: parseFloat(r.metrics?.conversions ?? '0'),
          impressions: parseFloat(r.metrics?.impressions ?? '0'),
          clicks: parseFloat(r.metrics?.clicks ?? '0'),
        });
      }
    } catch {
      // skip malformed stream chunk
    }
  }

  return rows;
}

// Converts raw campaign rows into the flat metric rows written to air_metric_snapshots.
// Emits both per-campaign rows (dimension = campaign_id) and account-level
// aggregates (dimension = null) so the anomaly detector can work at either level.
export function buildMetricRows(
  orgId: string,
  campaignRows: CampaignPerfRow[],
  date: string,
): AirMetricRow[] {
  const out: AirMetricRow[] = [];

  // Per-campaign metrics
  for (const r of campaignRows) {
    const dim = r.campaignId;
    const spend = r.costMicros / 1_000_000;
    const cpa = r.conversions > 0 ? spend / r.conversions : null;
    const ctr = r.impressions > 0 ? r.clicks / r.impressions : null;

    out.push({ org_id: orgId, source: 'google_ads', metric_name: 'spend',       dimension: dim, value: spend,           snapshot_date: date });
    out.push({ org_id: orgId, source: 'google_ads', metric_name: 'conversions', dimension: dim, value: r.conversions,    snapshot_date: date });
    out.push({ org_id: orgId, source: 'google_ads', metric_name: 'impressions', dimension: dim, value: r.impressions,    snapshot_date: date });
    out.push({ org_id: orgId, source: 'google_ads', metric_name: 'clicks',      dimension: dim, value: r.clicks,         snapshot_date: date });
    if (cpa !== null)  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'cpa', dimension: dim, value: cpa, snapshot_date: date });
    if (ctr !== null)  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'ctr', dimension: dim, value: ctr, snapshot_date: date });
  }

  // No campaigns → no account-level aggregates to emit
  if (campaignRows.length === 0) return out;

  // Account-level aggregates (dimension = null)
  const totals = campaignRows.reduce(
    (acc, r) => ({
      costMicros:  acc.costMicros  + r.costMicros,
      conversions: acc.conversions + r.conversions,
      impressions: acc.impressions + r.impressions,
      clicks:      acc.clicks      + r.clicks,
    }),
    { costMicros: 0, conversions: 0, impressions: 0, clicks: 0 },
  );

  const totalSpend = totals.costMicros / 1_000_000;
  const totalCpa   = totals.conversions > 0 ? totalSpend / totals.conversions : null;
  const totalCtr   = totals.impressions > 0 ? totals.clicks / totals.impressions : null;

  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'spend',       dimension: null, value: totalSpend,        snapshot_date: date });
  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'conversions', dimension: null, value: totals.conversions, snapshot_date: date });
  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'impressions', dimension: null, value: totals.impressions, snapshot_date: date });
  out.push({ org_id: orgId, source: 'google_ads', metric_name: 'clicks',      dimension: null, value: totals.clicks,      snapshot_date: date });
  if (totalCpa !== null) out.push({ org_id: orgId, source: 'google_ads', metric_name: 'cpa', dimension: null, value: totalCpa, snapshot_date: date });
  if (totalCtr !== null) out.push({ org_id: orgId, source: 'google_ads', metric_name: 'ctr', dimension: null, value: totalCtr, snapshot_date: date });

  return out;
}

// Upserts rows into air_metric_snapshots. The UNIQUE constraint on
// (org_id, source, metric_name, dimension, snapshot_date) makes this idempotent.
async function writeMetricRows(rows: AirMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await (supabaseAdmin
    .from('air_metric_snapshots') as unknown as {
      upsert: (
        rows: AirMetricRow[],
        opts: { onConflict: string; ignoreDuplicates: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    })
    .upsert(rows, { onConflict: 'org_id,source,metric_name,dimension,snapshot_date', ignoreDuplicates: true });

  if (error) throw new Error(`air_metric_snapshots upsert failed: ${error.message}`);
}

// Entry point called by the ingestion orchestrator.
// Finds all active Google Ads connections for an org, fetches yesterday's
// campaign performance for each one, and writes metric rows.
// Skips gracefully if no connections exist.
export async function ingestGoogleAds(orgId: string, date = yesterday()): Promise<void> {
  // Find active Google Ads connections for this org (both standalone and child)
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, account_id, parent_connection_id')
    .eq('organization_id', orgId)
    .eq('platform', 'google_ads')
    .in('status', ['active', 'connected']);

  if (connErr) throw new Error(`Failed to query platform_connections: ${connErr.message}`);
  if (!connections || connections.length === 0) {
    logger.info({ orgId }, 'AIR/google_ads: no active connections — skipping');
    return;
  }

  type ConnRow = { id: string; account_id: string; parent_connection_id: string | null };
  const allRows: AirMetricRow[] = [];

  for (const conn of connections as ConnRow[]) {
    try {
      const tokens = await resolveTokens(conn.id);
      const customerId = conn.account_id.replace(/-/g, '');

      let managerId: string | undefined;
      if (conn.parent_connection_id) {
        const { data: parent } = await supabaseAdmin
          .from('platform_connections')
          .select('account_id')
          .eq('id', conn.parent_connection_id)
          .single();
        if (parent) managerId = (parent as ConnRow).account_id.replace(/-/g, '');
      }

      const campaignRows = await fetchCampaignPerformance(customerId, tokens.access_token, date, managerId);
      const metricRows = buildMetricRows(orgId, campaignRows, date);
      allRows.push(...metricRows);

      logger.info({ orgId, connectionId: conn.id, campaigns: campaignRows.length, metrics: metricRows.length }, 'AIR/google_ads: fetched');
    } catch (err) {
      // One connection failing must not block others for the same org
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, connectionId: conn.id }, 'AIR/google_ads: connection fetch failed');
    }
  }

  // De-duplicate account-level aggregates across multiple connections for the
  // same org by summing them (an org may have ≥1 Google Ads account linked).
  // Campaign-level rows already use campaign_id as dimension so they are unique.
  const aggregated = aggregateAccountLevel(allRows, orgId, date);
  await writeMetricRows(aggregated);
}

// When an org has multiple Google Ads connections, account-level (dimension=null)
// rows need to be summed rather than duplicated. Campaign-level rows pass through.
function aggregateAccountLevel(rows: AirMetricRow[], orgId: string, date: string): AirMetricRow[] {
  const accountTotals = new Map<string, number>(); // metric_name → sum
  const campaignRows: AirMetricRow[] = [];

  for (const r of rows) {
    if (r.dimension === null) {
      accountTotals.set(r.metric_name, (accountTotals.get(r.metric_name) ?? 0) + r.value);
    } else {
      campaignRows.push(r);
    }
  }

  const accountRows: AirMetricRow[] = [];
  for (const [metric_name, value] of accountTotals) {
    // Re-derive CPA and CTR from summed totals rather than averaging them
    if (metric_name === 'cpa' || metric_name === 'ctr') continue;
    accountRows.push({ org_id: orgId, source: 'google_ads', metric_name, dimension: null, value, snapshot_date: date });
  }

  // Recompute CPA and CTR from the summed totals
  const spend       = accountTotals.get('spend') ?? 0;
  const conversions = accountTotals.get('conversions') ?? 0;
  const impressions = accountTotals.get('impressions') ?? 0;
  const clicks      = accountTotals.get('clicks') ?? 0;
  if (conversions > 0) accountRows.push({ org_id: orgId, source: 'google_ads', metric_name: 'cpa', dimension: null, value: spend / conversions, snapshot_date: date });
  if (impressions > 0) accountRows.push({ org_id: orgId, source: 'google_ads', metric_name: 'ctr', dimension: null, value: clicks / impressions, snapshot_date: date });

  return [...campaignRows, ...accountRows];
}
