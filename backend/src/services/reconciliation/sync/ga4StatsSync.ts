import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';

const GA4_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

interface ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

async function fetchKeyEventReport(propertyId: string, accessToken: string, daysBack = 7): Promise<ReportRow[]> {
  const res = await fetch(`${GA4_DATA_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dimensions: [{ name: 'keyEventName' }, { name: 'date' }],
      metrics: [{ name: 'keyEvents' }],
      dateRanges: [{ startDate: `${daysBack}daysAgo`, endDate: 'yesterday' }],
      limit: 10000,
    }),
  });

  if (!res.ok) throw new Error(`GA4 Data API failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { rows?: ReportRow[] };
  return json.rows ?? [];
}

async function getAtlasCount(clientId: string, eventName: string, date: string): Promise<number | null> {
  const { count } = await supabaseAdmin
    .from('capi_events')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('event_name', eventName)
    .gte('created_at', `${date}T00:00:00Z`)
    .lte('created_at', `${date}T23:59:59Z`) as unknown as { count: number | null };
  return count ?? null;
}

export async function syncKeyEventStats(connectionId: string, orgId: string, clientId: string, daysBack = 7): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  // GA4 connections store the property ID in account_id (prefixed with "properties/" or bare)
  const rawPropertyId = (conn as { account_id: string }).account_id;
  const propertyId = rawPropertyId.startsWith('properties/') ? rawPropertyId.split('/')[1] : rawPropertyId;

  const rows = await fetchKeyEventReport(propertyId, tokens.access_token, daysBack);

  const upserts: object[] = [];
  for (const row of rows) {
    const eventName = row.dimensionValues[0]?.value ?? '';
    const rawDate = row.dimensionValues[1]?.value ?? '';  // YYYYMMDD
    const platformCount = parseInt(row.metricValues[0]?.value ?? '0', 10);
    if (!eventName || !rawDate) continue;

    // Convert GA4 date YYYYMMDD → YYYY-MM-DD
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const atlasCount = await getAtlasCount(clientId, eventName, date);
    const deltaRaw = atlasCount !== null && atlasCount > 0
      ? ((platformCount - atlasCount) / atlasCount) * 100
      : null;

    upserts.push({
      connection_id: connectionId,
      organization_id: orgId,
      client_id: clientId,
      date,
      event_name: eventName,
      platform_count: platformCount,
      atlas_count: atlasCount,
      delta_pct: deltaRaw !== null ? Math.round(deltaRaw * 100) / 100 : null,
      synced_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    await (supabaseAdmin
      .from('platform_event_stats_daily') as unknown as {
        upsert: (rows: object[], opts: object) => Promise<{ error: Error | null }>;
      })
      .upsert(upserts, { onConflict: 'connection_id,date,event_name' });
  }

  await (supabaseAdmin
    .from('platform_connections') as unknown as {
      update: (patch: object) => { eq: (col: string, val: string) => Promise<void> };
    })
    .update({ last_stats_synced_at: new Date().toISOString() })
    .eq('id', connectionId);
}
