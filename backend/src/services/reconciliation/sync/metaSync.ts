import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

async function graphGet(path: string, accessToken: string): Promise<unknown> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Meta Graph API ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

async function paginate<T>(
  firstPath: string,
  accessToken: string,
): Promise<T[]> {
  const results: T[] = [];
  let path: string | null = firstPath;

  while (path) {
    const data = await graphGet(path, accessToken) as {
      data?: T[];
      paging?: { next?: string };
    };
    results.push(...(data.data ?? []));
    const next = data.paging?.next;
    if (!next) break;
    // next is an absolute URL; extract path+query
    path = next.replace(`${GRAPH_BASE}/`, '');
  }

  return results;
}

export async function syncCustomConversions(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const adAccountId = `act_${(conn as { account_id: string }).account_id.replace(/^act_/, '')}`;

  interface MetaCustomConversion {
    id: string;
    name: string;
    custom_event_type?: string;
    event_source_url?: string;
    pixel_id?: string;
    aem_enabled?: boolean;
  }

  const conversions = await paginate<MetaCustomConversion>(
    `${adAccountId}/customconversions?fields=id,name,custom_event_type,event_source_url,pixel_id,aem_enabled&limit=200`,
    tokens.access_token,
  );

  for (const cv of conversions) {
    const record = {
      connection_id: connectionId,
      organization_id: orgId,
      external_id: cv.id,
      name: cv.name,
      status: 'ACTIVE',
      category: cv.custom_event_type ?? null,
      raw: cv,
      observed_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('platform_conversion_actions')
      .upsert(record, { onConflict: 'connection_id,external_id' });

    if (error) {
      logger.warn({ connectionId, externalId: cv.id, err: error.message }, 'Failed to upsert Meta custom conversion');
    }
  }

  logger.info({ connectionId, count: conversions.length }, 'Meta custom conversions synced');
}

export async function syncAemPriorities(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const adAccountId = `act_${(conn as { account_id: string }).account_id.replace(/^act_/, '')}`;

  // Fetch AEM pixel signals to determine priority ranking
  interface AemEntry { id: string; name: string; custom_event_type?: string; priority?: number }
  const aemSignals = await paginate<AemEntry>(
    `${adAccountId}/aem_conversion_filter?fields=id,name,custom_event_type,priority&limit=200`,
    tokens.access_token,
  ).catch(() => [] as AemEntry[]);

  for (const signal of aemSignals) {
    const priority = typeof signal.priority === 'number' ? signal.priority : 99;

    const { error } = await supabaseAdmin
      .from('platform_conversion_actions')
      .update({ aem_priority: priority, observed_at: new Date().toISOString() })
      .eq('connection_id', connectionId)
      .eq('external_id', signal.id);

    if (error) {
      logger.warn({ connectionId, signalId: signal.id, err: error.message }, 'Failed to update AEM priority');
    }
  }

  logger.info({ connectionId, count: aemSignals.length }, 'Meta AEM priorities synced');
}

export async function syncMetaCampaigns(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const adAccountId = `act_${(conn as { account_id: string }).account_id.replace(/^act_/, '')}`;

  interface MetaCampaign {
    id: string;
    name: string;
    status: string;
    objective?: string;
    promoted_object?: { custom_event_type?: string; custom_conversion_id?: string };
    daily_budget?: string;
    lifetime_budget?: string;
  }

  const campaigns = await paginate<MetaCampaign>(
    `${adAccountId}/campaigns?fields=id,name,status,objective,promoted_object,daily_budget,lifetime_budget&limit=200`,
    tokens.access_token,
  );

  for (const c of campaigns) {
    const record = {
      connection_id: connectionId,
      organization_id: orgId,
      external_campaign_id: c.id,
      campaign_name: c.name,
      status: c.status,
      optimization_goal: c.objective ?? null,
      custom_event_type: c.promoted_object?.custom_event_type ?? null,
      // Campaigns that optimise on a specific custom conversion have the ID here
      selective_optimization_actions: c.promoted_object?.custom_conversion_id
        ? [c.promoted_object.custom_conversion_id]
        : [],
      budget_micros: c.daily_budget
        ? BigInt(c.daily_budget) * BigInt(10)    // Meta returns in cents, convert to micros
        : c.lifetime_budget
          ? BigInt(c.lifetime_budget) * BigInt(10)
          : null,
      raw: c,
      observed_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('platform_campaign_goals')
      .upsert(
        { ...record, budget_micros: record.budget_micros ? String(record.budget_micros) : null },
        { onConflict: 'connection_id,external_campaign_id' },
      );

    if (error) {
      logger.warn({ connectionId, campaignId: c.id, err: error.message }, 'Failed to upsert Meta campaign');
    }
  }

  logger.info({ connectionId, count: campaigns.length }, 'Meta campaigns synced');
}
