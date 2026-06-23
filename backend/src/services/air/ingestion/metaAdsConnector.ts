// Meta Ads ingestion connector for Auto-insight Reporter.
// Pulls campaign-level spend, impressions, clicks, and conversions for
// yesterday via the Graph API Insights endpoint. Writes to air_metric_snapshots.
//
// Auth: reuses resolveTokens() — Meta tokens from the existing OAuth flow
// already carry ads_read scope.

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';
import { AirMetricRow, yesterday, writeMetricRows } from '@/services/air/ingestion/airIngestionUtils';

const META_BASE = 'https://graph.facebook.com/v19.0';

// Action types summed as "conversions" for CPA calculation.
const CONVERSION_ACTION_TYPES = new Set([
  'purchase',
  'lead',
  'complete_registration',
  'contact',
  'submit_application',
  'offsite_conversion.fb_pixel_purchase',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_complete_registration',
]);

interface MetaCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

// Fetches campaign-level insights for a single ad account on a given date.
// Handles cursor pagination.
export async function fetchMetaCampaignInsights(
  adAccountId: string,
  accessToken: string,
  date: string,
): Promise<MetaCampaignInsight[]> {
  const params = new URLSearchParams({
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'campaign',
    time_increment: '1',
    limit: '500',
    access_token: accessToken,
  });

  const results: MetaCampaignInsight[] = [];
  let url: string | null = `${META_BASE}/act_${adAccountId}/insights?${params}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meta Insights API error (${res.status}): ${body}`);
    }
    const json = await res.json() as {
      data?: {
        campaign_id?: string;
        campaign_name?: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: { action_type: string; value: string }[];
      }[];
      paging?: { next?: string };
    };

    for (const row of json.data ?? []) {
      if (!row.campaign_id) continue;
      const conversions = (row.actions ?? [])
        .filter((a) => CONVERSION_ACTION_TYPES.has(a.action_type))
        .reduce((sum, a) => sum + parseFloat(a.value), 0);

      results.push({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name ?? '',
        spend: parseFloat(row.spend ?? '0'),
        impressions: parseFloat(row.impressions ?? '0'),
        clicks: parseFloat(row.clicks ?? '0'),
        conversions,
      });
    }

    url = json.paging?.next ?? null;
  }

  return results;
}

// Converts raw campaign insights into flat metric rows.
// Emits per-campaign rows (dimension = campaign_id) and account-level
// aggregates (dimension = null).
export function buildMetaMetricRows(
  orgId: string,
  insights: MetaCampaignInsight[],
  date: string,
): AirMetricRow[] {
  const out: AirMetricRow[] = [];

  for (const r of insights) {
    const dim = r.campaignId;
    const cpa = r.conversions > 0 ? r.spend / r.conversions : null;
    const ctr = r.impressions > 0 ? r.clicks / r.impressions : null;

    out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'spend',       dimension: dim, value: r.spend,        snapshot_date: date });
    out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'conversions', dimension: dim, value: r.conversions,  snapshot_date: date });
    out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'impressions', dimension: dim, value: r.impressions,  snapshot_date: date });
    out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'clicks',      dimension: dim, value: r.clicks,       snapshot_date: date });
    if (cpa !== null) out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'cpa', dimension: dim, value: cpa, snapshot_date: date });
    if (ctr !== null) out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'ctr', dimension: dim, value: ctr, snapshot_date: date });
  }

  if (insights.length === 0) return out;

  // Account-level aggregates
  const totals = insights.reduce(
    (acc, r) => ({
      spend:       acc.spend       + r.spend,
      conversions: acc.conversions + r.conversions,
      impressions: acc.impressions + r.impressions,
      clicks:      acc.clicks      + r.clicks,
    }),
    { spend: 0, conversions: 0, impressions: 0, clicks: 0 },
  );

  const totalCpa = totals.conversions > 0 ? totals.spend / totals.conversions : null;
  const totalCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : null;

  out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'spend',       dimension: null, value: totals.spend,        snapshot_date: date });
  out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'conversions', dimension: null, value: totals.conversions,  snapshot_date: date });
  out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'impressions', dimension: null, value: totals.impressions,  snapshot_date: date });
  out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'clicks',      dimension: null, value: totals.clicks,       snapshot_date: date });
  if (totalCpa !== null) out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'cpa', dimension: null, value: totalCpa, snapshot_date: date });
  if (totalCtr !== null) out.push({ org_id: orgId, source: 'meta_ads', metric_name: 'ctr', dimension: null, value: totalCtr, snapshot_date: date });

  return out;
}

// Entry point called by the ingestion orchestrator.
export async function ingestMetaAds(orgId: string, date = yesterday()): Promise<void> {
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, account_id')
    .eq('organization_id', orgId)
    .eq('platform', 'meta_ads')
    .in('status', ['active', 'connected']);

  if (connErr) throw new Error(`Failed to query platform_connections: ${connErr.message}`);
  if (!connections || connections.length === 0) {
    logger.info({ orgId }, 'AIR/meta_ads: no active connections — skipping');
    return;
  }

  type ConnRow = { id: string; account_id: string };
  const allRows: AirMetricRow[] = [];

  for (const conn of connections as ConnRow[]) {
    try {
      const tokens = await resolveTokens(conn.id);
      const adAccountId = conn.account_id.replace(/^act_/, '');
      const insights = await fetchMetaCampaignInsights(adAccountId, tokens.access_token, date);
      const metricRows = buildMetaMetricRows(orgId, insights, date);
      allRows.push(...metricRows);
      logger.info({ orgId, connectionId: conn.id, campaigns: insights.length, metrics: metricRows.length }, 'AIR/meta_ads: fetched');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, connectionId: conn.id }, 'AIR/meta_ads: connection fetch failed');
    }
  }

  await writeMetricRows(allRows);
}
