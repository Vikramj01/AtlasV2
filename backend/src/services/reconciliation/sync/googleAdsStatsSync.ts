import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import { env } from '@/config/env';

const GADS_BASE = 'https://googleads.googleapis.com/v18';

interface ConversionRow {
  date: string;
  eventName: string;
  conversions: number;
}

async function fetchConversionStats(
  customerId: string,
  accessToken: string,
  managerId?: string,
): Promise<ConversionRow[]> {
  const query = `
    SELECT
      segments.date,
      conversion_action.name,
      metrics.conversions
    FROM conversion_action
    WHERE segments.date DURING LAST_7_DAYS
    ORDER BY segments.date DESC
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
  if (!res.ok) throw new Error(`Google Ads stats failed: ${res.status}`);

  const rows: ConversionRow[] = [];
  const text = await res.text();
  for (const line of text.split('\n').filter((l) => l.trim().startsWith('{'))) {
    try {
      const parsed = JSON.parse(line) as {
        results?: {
          segments?: { date?: string };
          conversionAction?: { name?: string };
          metrics?: { conversions?: string };
        }[];
      };
      for (const r of parsed.results ?? []) {
        if (r.segments?.date && r.conversionAction?.name) {
          rows.push({
            date: r.segments.date,
            eventName: r.conversionAction.name,
            conversions: parseFloat(r.metrics?.conversions ?? '0'),
          });
        }
      }
    } catch {
      // skip malformed chunk
    }
  }
  return rows;
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

export async function syncConversionStats(connectionId: string, orgId: string, clientId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id, parent_connection_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const connTyped = conn as { account_id: string; parent_connection_id: string | null };
  const customerId = connTyped.account_id.replace(/-/g, '');

  let managerId: string | undefined;
  if (connTyped.parent_connection_id) {
    const { data: parent } = await supabaseAdmin
      .from('platform_connections')
      .select('account_id')
      .eq('id', connTyped.parent_connection_id)
      .single();
    if (parent) managerId = (parent as { account_id: string }).account_id.replace(/-/g, '');
  }

  const rows = await fetchConversionStats(customerId, tokens.access_token, managerId);

  // Aggregate by (date, eventName)
  const agg = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.date}::${r.eventName}`;
    agg.set(key, (agg.get(key) ?? 0) + r.conversions);
  }

  const upserts: object[] = [];
  for (const [key, platformCount] of agg) {
    const [date, eventName] = key.split('::');
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
      platform_count: Math.round(platformCount),
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
