import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';

const META_BASE = 'https://graph.facebook.com/v19.0';

interface InsightAction {
  action_type: string;
  value: string;
}

interface DayInsight {
  date_start: string;
  actions?: InsightAction[];
}

async function fetchInsights(adAccountId: string, accessToken: string): Promise<DayInsight[]> {
  const params = new URLSearchParams({
    fields: 'date_start,actions',
    time_increment: '1',
    date_preset: 'last_7_days',
    level: 'account',
    limit: '10',
    access_token: accessToken,
  });

  const results: DayInsight[] = [];
  let url: string | undefined = `${META_BASE}/act_${adAccountId}/insights?${params}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta insights failed: ${res.status}`);
    const json = await res.json() as { data?: DayInsight[]; paging?: { next?: string } };
    results.push(...(json.data ?? []));
    url = json.paging?.next;
  }
  return results;
}

interface QualityMetric {
  event_name: string;
  event_match_score: number;
}

async function fetchEventMatchScores(adAccountId: string, accessToken: string): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  try {
    const params = new URLSearchParams({
      fields: 'event_name,event_match_score',
      access_token: accessToken,
    });
    const res = await fetch(`${META_BASE}/act_${adAccountId}/signal_quality_metrics?${params}`);
    if (!res.ok) return scores;
    const json = await res.json() as { data?: QualityMetric[] };
    for (const m of json.data ?? []) {
      scores.set(m.event_name, m.event_match_score);
    }
  } catch {
    // quality metrics are optional — don't fail the whole sync
  }
  return scores;
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

export async function syncAdAccountStats(connectionId: string, orgId: string, clientId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const adAccountId = (conn as { account_id: string }).account_id;
  const [insights, matchScores] = await Promise.all([
    fetchInsights(adAccountId, tokens.access_token),
    fetchEventMatchScores(adAccountId, tokens.access_token),
  ]);

  const upserts: object[] = [];
  for (const day of insights) {
    const date = day.date_start;
    for (const action of day.actions ?? []) {
      const eventName = action.action_type;
      const platformCount = parseFloat(action.value);
      const atlasCount = await getAtlasCount(clientId, eventName, date);
      const deltaRaw = atlasCount !== null && atlasCount > 0
        ? ((platformCount - atlasCount) / atlasCount) * 100
        : null;

      const qualitySignals: Record<string, number> = {};
      const matchScore = matchScores.get(eventName);
      if (matchScore !== undefined) qualitySignals.event_match_score = matchScore;

      upserts.push({
        connection_id: connectionId,
        organization_id: orgId,
        client_id: clientId,
        date,
        event_name: eventName,
        platform_count: Math.round(platformCount),
        atlas_count: atlasCount,
        delta_pct: deltaRaw !== null ? Math.round(deltaRaw * 100) / 100 : null,
        quality_signals: Object.keys(qualitySignals).length > 0 ? qualitySignals : null,
        synced_at: new Date().toISOString(),
      });
    }
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
