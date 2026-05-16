import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const ADS_API_BASE = 'https://googleads.googleapis.com/v18';

async function adsPost(
  path: string,
  body: unknown,
  accessToken: string,
  loginCustomerId?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  const res = await fetch(`${ADS_API_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Ads API ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function syncConversionActions(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id, parent_connection_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const accountId = (conn as { account_id: string; parent_connection_id: string | null }).account_id.replace(/-/g, '');

  const gaql = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.category,
      conversion_action.primary_for_goal,
      conversion_action.attribution_model_settings.attribution_model,
      conversion_action.counting_type,
      conversion_action.click_through_lookback_window_days,
      conversion_action.view_through_lookback_window_days,
      conversion_action.value_settings.default_value,
      conversion_action.value_settings.default_currency_code,
      conversion_action.value_settings.always_use_default_value,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `;

  const response = await adsPost(
    `customers/${accountId}/googleAds:searchStream`,
    { query: gaql },
    tokens.access_token,
  ) as { results?: Array<{ conversion_action: Record<string, unknown> }> }[];

  const rows = (Array.isArray(response) ? response : [response]).flatMap(
    (batch: { results?: Array<{ conversion_action: Record<string, unknown> }> }) =>
      batch.results ?? [],
  );

  for (const row of rows) {
    const ca = row.conversion_action as Record<string, unknown>;
    const vs = ca.value_settings as Record<string, unknown> | undefined;
    const attrSettings = ca.attribution_model_settings as Record<string, unknown> | undefined;

    const record = {
      connection_id: connectionId,
      organization_id: orgId,
      external_id: String(ca.id ?? ''),
      name: String(ca.name ?? ''),
      status: String(ca.status ?? ''),
      category: String(ca.category ?? ''),
      primary_for_goal: Boolean(ca.primary_for_goal),
      attribution_model: attrSettings ? String(attrSettings.attribution_model ?? '') : null,
      counting_type: String(ca.counting_type ?? ''),
      click_lookback_days: Number(ca.click_through_lookback_window_days) || null,
      view_lookback_days: Number(ca.view_through_lookback_window_days) || null,
      value_settings: vs ? {
        default_value: vs.default_value,
        default_currency: vs.default_currency_code,
        always_use_default: vs.always_use_default_value,
      } : null,
      include_in_conversions: Boolean(ca.include_in_conversions_metric),
      raw: ca,
      observed_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('platform_conversion_actions')
      .upsert(record, { onConflict: 'connection_id,external_id' });

    if (error) {
      logger.warn({ connectionId, externalId: record.external_id, err: error.message }, 'Failed to upsert conversion action');
    }
  }

  logger.info({ connectionId, count: rows.length }, 'Google Ads conversion actions synced');
}

export async function syncCampaignGoals(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const accountId = (conn as { account_id: string }).account_id.replace(/-/g, '');

  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.selective_optimization.conversion_actions
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `;

  const response = await adsPost(
    `customers/${accountId}/googleAds:searchStream`,
    { query: gaql },
    tokens.access_token,
  ) as { results?: Array<{ campaign: Record<string, unknown> }> }[];

  const rows = (Array.isArray(response) ? response : [response]).flatMap(
    (batch: { results?: Array<{ campaign: Record<string, unknown> }> }) =>
      batch.results ?? [],
  );

  for (const row of rows) {
    const c = row.campaign as Record<string, unknown>;
    const selOpt = c.selective_optimization as { conversion_actions?: string[] } | undefined;

    const record = {
      connection_id: connectionId,
      organization_id: orgId,
      external_campaign_id: String(c.id ?? ''),
      campaign_name: String(c.name ?? ''),
      campaign_type: String(c.advertising_channel_type ?? ''),
      status: String(c.status ?? ''),
      selective_optimization_actions: selOpt?.conversion_actions ?? [],
      raw: c,
      observed_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('platform_campaign_goals')
      .upsert(record, { onConflict: 'connection_id,external_campaign_id' });

    if (error) {
      logger.warn({ connectionId, campaignId: record.external_campaign_id, err: error.message }, 'Failed to upsert campaign goal');
    }
  }

  logger.info({ connectionId, count: rows.length }, 'Google Ads campaign goals synced');
}
