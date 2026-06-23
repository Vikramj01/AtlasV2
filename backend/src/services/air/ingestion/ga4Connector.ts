// GA4 ingestion connector for Auto-insight Reporter.
// Pulls session and key-event metrics broken down by channel group for
// yesterday. Writes to air_metric_snapshots.
//
// Auth: reuses resolveTokens() — GA4 tokens from the existing OAuth flow
// already carry analytics.readonly scope.

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';
import { AirMetricRow, yesterday, writeMetricRows } from '@/services/air/ingestion/airIngestionUtils';

const GA4_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

interface GA4ChannelRow {
  channelGroup: string;
  sessions: number;
  keyEvents: number;
  engagedSessions: number;
  bounceRate: number;
  engagementRate: number;
}

// Fetches session + key-event metrics per channel group for a single date.
export async function fetchGA4ChannelMetrics(
  propertyId: string,
  accessToken: string,
  date: string,
): Promise<GA4ChannelRow[]> {
  const res = await fetch(`${GA4_DATA_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'keyEvents' },
        { name: 'engagedSessions' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
      ],
      dateRanges: [{ startDate: date, endDate: date }],
      limit: 250,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA4 Data API error (${res.status}): ${body}`);
  }

  const json = await res.json() as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  return (json.rows ?? []).map((row) => ({
    channelGroup:    row.dimensionValues[0]?.value ?? 'Unknown',
    sessions:        parseFloat(row.metricValues[0]?.value ?? '0'),
    keyEvents:       parseFloat(row.metricValues[1]?.value ?? '0'),
    engagedSessions: parseFloat(row.metricValues[2]?.value ?? '0'),
    bounceRate:      parseFloat(row.metricValues[3]?.value ?? '0'),
    engagementRate:  parseFloat(row.metricValues[4]?.value ?? '0'),
  }));
}

// Converts channel rows into flat metric rows.
// Per-channel rows use channelGroup as dimension; account-level rows use null.
// bounce_rate and engagement_rate at account level are recomputed from raw
// session counts rather than averaged across channels.
export function buildGA4MetricRows(
  orgId: string,
  channelRows: GA4ChannelRow[],
  date: string,
): AirMetricRow[] {
  const out: AirMetricRow[] = [];

  for (const r of channelRows) {
    const dim = r.channelGroup;
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'sessions',         dimension: dim, value: r.sessions,        snapshot_date: date });
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'key_events',       dimension: dim, value: r.keyEvents,        snapshot_date: date });
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'engaged_sessions', dimension: dim, value: r.engagedSessions,  snapshot_date: date });
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'bounce_rate',      dimension: dim, value: r.bounceRate,       snapshot_date: date });
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'engagement_rate',  dimension: dim, value: r.engagementRate,   snapshot_date: date });
  }

  if (channelRows.length === 0) return out;

  // Account-level aggregates — sum additive metrics, recompute rates
  const totals = channelRows.reduce(
    (acc, r) => ({
      sessions:        acc.sessions        + r.sessions,
      keyEvents:       acc.keyEvents       + r.keyEvents,
      engagedSessions: acc.engagedSessions + r.engagedSessions,
    }),
    { sessions: 0, keyEvents: 0, engagedSessions: 0 },
  );

  out.push({ org_id: orgId, source: 'ga4', metric_name: 'sessions',         dimension: null, value: totals.sessions,        snapshot_date: date });
  out.push({ org_id: orgId, source: 'ga4', metric_name: 'key_events',       dimension: null, value: totals.keyEvents,        snapshot_date: date });
  out.push({ org_id: orgId, source: 'ga4', metric_name: 'engaged_sessions', dimension: null, value: totals.engagedSessions,  snapshot_date: date });

  if (totals.sessions > 0) {
    const totalBounceRate      = (totals.sessions - totals.engagedSessions) / totals.sessions;
    const totalEngagementRate  = totals.engagedSessions / totals.sessions;
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'bounce_rate',     dimension: null, value: totalBounceRate,     snapshot_date: date });
    out.push({ org_id: orgId, source: 'ga4', metric_name: 'engagement_rate', dimension: null, value: totalEngagementRate, snapshot_date: date });
  }

  return out;
}

// Entry point called by the ingestion orchestrator.
export async function ingestGA4(orgId: string, date = yesterday()): Promise<void> {
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, account_id')
    .eq('organization_id', orgId)
    .eq('platform', 'ga4')
    .in('status', ['active', 'connected']);

  if (connErr) throw new Error(`Failed to query platform_connections: ${connErr.message}`);
  if (!connections || connections.length === 0) {
    logger.info({ orgId }, 'AIR/ga4: no active connections — skipping');
    return;
  }

  type ConnRow = { id: string; account_id: string };
  const allRows: AirMetricRow[] = [];

  for (const conn of connections as ConnRow[]) {
    try {
      const tokens = await resolveTokens(conn.id);
      // account_id may arrive as "properties/123" or bare "123"
      const raw = conn.account_id;
      const propertyId = raw.startsWith('properties/') ? raw.split('/')[1] : raw;
      const channelRows = await fetchGA4ChannelMetrics(propertyId, tokens.access_token, date);
      const metricRows  = buildGA4MetricRows(orgId, channelRows, date);
      allRows.push(...metricRows);
      logger.info({ orgId, connectionId: conn.id, channels: channelRows.length, metrics: metricRows.length }, 'AIR/ga4: fetched');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, connectionId: conn.id }, 'AIR/ga4: connection fetch failed');
    }
  }

  await writeMetricRows(allRows);
}
