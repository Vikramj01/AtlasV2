// LinkedIn Ads ingestion connector for Auto-insight Reporter (B13).
// Pulls campaign-level spend, impressions, clicks, and conversions for
// yesterday via the LinkedIn Marketing API's adAnalytics finder. Writes to
// air_metric_snapshots.
//
// Auth: reuses resolveTokens() against a platform_connections row with
// platform='linkedin'. No OAuth connect flow exists yet to create such a
// row (see 20260828005_air_linkedin_connector.sql's note) — until one is
// built, this connector runs as a structurally-correct no-op, same as any
// AIR connector for an org with no matching connection.

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';
import { AirMetricRow, yesterday, writeMetricRows } from '@/services/air/ingestion/airIngestionUtils';

const LINKEDIN_API_BASE = 'https://api.linkedin.com';
// Keep in sync with backend/src/services/capi/linkedinDelivery.ts's LINKEDIN_VERSION —
// both are subject to the same annual sunset (see M1 in the sprint plan).
const LINKEDIN_VERSION = '202608';

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_VERSION,
  };
}

interface LinkedInCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

interface AdAnalyticsElement {
  pivotValues?: string[]; // e.g. ["urn:li:sponsoredCampaign:123456"]
  impressions?: number;
  clicks?: number;
  costInLocalCurrency?: string;
  externalWebsiteConversions?: number;
}

// Fetches campaign-level ad analytics for a single ad account on a given date.
export async function fetchLinkedInCampaignInsights(
  adAccountId: string,
  accessToken: string,
  date: string,
): Promise<LinkedInCampaignInsight[]> {
  const [year, month, day] = date.split('-').map(Number);
  const dateRange = `(start:(year:${year},month:${month},day:${day}),end:(year:${year},month:${month},day:${day}))`;

  const params = new URLSearchParams({
    q: 'analytics',
    pivot: 'CAMPAIGN',
    timeGranularity: 'DAILY',
    dateRange,
    accounts: `List(urn:li:sponsoredAccount:${adAccountId})`,
    fields: 'pivotValues,impressions,clicks,costInLocalCurrency,externalWebsiteConversions',
  });

  const url = `${LINKEDIN_API_BASE}/rest/adAnalytics?${params}`;
  const res = await fetch(url, { headers: linkedInHeaders(accessToken) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LinkedIn Ad Analytics API error (${res.status}): ${body}`);
  }

  const json = await res.json() as { elements?: AdAnalyticsElement[] };
  const campaignNames = await fetchCampaignNames(adAccountId, accessToken);

  const results: LinkedInCampaignInsight[] = [];
  for (const el of json.elements ?? []) {
    const campaignUrn = el.pivotValues?.[0];
    if (!campaignUrn) continue;
    const campaignId = campaignUrn.split(':').pop() ?? campaignUrn;

    results.push({
      campaignId,
      campaignName: campaignNames.get(campaignId) ?? '',
      spend: parseFloat(el.costInLocalCurrency ?? '0'),
      impressions: el.impressions ?? 0,
      clicks: el.clicks ?? 0,
      conversions: el.externalWebsiteConversions ?? 0,
    });
  }

  return results;
}

// Best-effort campaign name lookup — falls back to an empty name if it fails,
// since names are cosmetic (campaignId is the join key everywhere else).
async function fetchCampaignNames(adAccountId: string, accessToken: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const url = `${LINKEDIN_API_BASE}/rest/adAccounts/${adAccountId}/adCampaigns?q=search`;
    const res = await fetch(url, { headers: linkedInHeaders(accessToken) });
    if (!res.ok) return names;
    const json = await res.json() as { elements?: Array<{ id: number; name: string }> };
    for (const c of json.elements ?? []) {
      names.set(String(c.id), c.name);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'AIR/linkedin_ads: campaign name lookup failed');
  }
  return names;
}

// Converts raw campaign insights into flat metric rows.
// Emits per-campaign rows (dimension = campaign_id) and account-level
// aggregates (dimension = null), mirroring buildMetaMetricRows().
export function buildLinkedInMetricRows(
  orgId: string,
  insights: LinkedInCampaignInsight[],
  date: string,
): AirMetricRow[] {
  const out: AirMetricRow[] = [];

  for (const r of insights) {
    const dim = r.campaignId;
    const cpa = r.conversions > 0 ? r.spend / r.conversions : null;
    const ctr = r.impressions > 0 ? r.clicks / r.impressions : null;

    out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'spend',       dimension: dim, value: r.spend,        snapshot_date: date });
    out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'conversions', dimension: dim, value: r.conversions,  snapshot_date: date });
    out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'impressions', dimension: dim, value: r.impressions,  snapshot_date: date });
    out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'clicks',      dimension: dim, value: r.clicks,       snapshot_date: date });
    if (cpa !== null) out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'cpa', dimension: dim, value: cpa, snapshot_date: date });
    if (ctr !== null) out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'ctr', dimension: dim, value: ctr, snapshot_date: date });
  }

  if (insights.length === 0) return out;

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

  out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'spend',       dimension: null, value: totals.spend,        snapshot_date: date });
  out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'conversions', dimension: null, value: totals.conversions,  snapshot_date: date });
  out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'impressions', dimension: null, value: totals.impressions,  snapshot_date: date });
  out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'clicks',      dimension: null, value: totals.clicks,       snapshot_date: date });
  if (totalCpa !== null) out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'cpa', dimension: null, value: totalCpa, snapshot_date: date });
  if (totalCtr !== null) out.push({ org_id: orgId, source: 'linkedin_ads', metric_name: 'ctr', dimension: null, value: totalCtr, snapshot_date: date });

  return out;
}

// Entry point called by the ingestion orchestrator.
export async function ingestLinkedInAds(orgId: string, date = yesterday()): Promise<void> {
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, account_id')
    .eq('organization_id', orgId)
    .eq('platform', 'linkedin')
    .in('status', ['active', 'connected']);

  if (connErr) throw new Error(`Failed to query platform_connections: ${connErr.message}`);
  if (!connections || connections.length === 0) {
    logger.info({ orgId }, 'AIR/linkedin_ads: no active connections — skipping');
    return;
  }

  type ConnRow = { id: string; account_id: string };
  const allRows: AirMetricRow[] = [];

  for (const conn of connections as ConnRow[]) {
    try {
      const tokens = await resolveTokens(conn.id);
      const insights = await fetchLinkedInCampaignInsights(conn.account_id, tokens.access_token, date);
      const metricRows = buildLinkedInMetricRows(orgId, insights, date);
      allRows.push(...metricRows);
      logger.info({ orgId, connectionId: conn.id, campaigns: insights.length, metrics: metricRows.length }, 'AIR/linkedin_ads: fetched');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, connectionId: conn.id }, 'AIR/linkedin_ads: connection fetch failed');
    }
  }

  await writeMetricRows(allRows);
}
