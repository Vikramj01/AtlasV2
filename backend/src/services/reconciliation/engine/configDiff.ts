import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation, getSeverity, getDimension } from '../codes/findingCodes';
import logger from '@/utils/logger';

interface ConversionAction {
  id: string;
  connection_id: string;
  external_id: string;
  name: string;
  status: string | null;
  attribution_model: string | null;
  counting_type: string | null;
  click_lookback_days: number | null;
  value_settings: { default_value?: number; default_currency?: string; always_use_default?: boolean } | null;
  aem_priority: number | null;
  primary_for_goal: boolean | null;
}

interface StrategyObjective {
  id: string;
  name: string;
  recommended_primary_event: string | null;
  conversion_tier: string | null;
  platform_action_types: Record<string, unknown> | null;
  proxy_event_required: boolean;
}

export async function runConfigDiff(
  runId: string,
  clientId: string,
  briefId: string,
  orgId: string,
): Promise<void> {
  // Load locked objectives for this brief
  const { data: objectives, error: objErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id, name, recommended_primary_event, conversion_tier, platform_action_types, proxy_event_required')
    .eq('brief_id', briefId)
    .eq('locked', true);

  if (objErr || !objectives?.length) {
    logger.info({ briefId }, 'No locked objectives found for config diff');
    return;
  }

  // Load active connections for this client
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform, account_id, account_label')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .in('platform', ['google_ads', 'meta', 'ga4']);

  if (connErr || !connections?.length) return;

  for (const conn of connections) {
    const platform = conn.platform as string;
    const connectionId = conn.id as string;
    const accountLabel = (conn.account_label ?? conn.account_id) as string;

    // Load conversion actions for this connection
    const { data: actions, error: actErr } = await supabaseAdmin
      .from('platform_conversion_actions')
      .select('id, connection_id, external_id, name, status, attribution_model, counting_type, click_lookback_days, value_settings, aem_priority, primary_for_goal')
      .eq('connection_id', connectionId);

    if (actErr || !actions) continue;

    const actionsByName = new Map<string, ConversionAction>();
    for (const a of actions as ConversionAction[]) {
      actionsByName.set(a.name.toLowerCase(), a);
    }

    for (const obj of objectives as StrategyObjective[]) {
      const primaryEventName = obj.recommended_primary_event;
      if (!primaryEventName) continue;

      const matchedAction = actionsByName.get(primaryEventName.toLowerCase());
      if (!matchedAction) continue;

      const platTypes = obj.platform_action_types as Record<string, Record<string, string>> | null;
      const platConfig = platTypes?.[platform] ?? {};

      // ── AEM Priority (Meta only) ──────────────────────────────────────────
      if (platform === 'meta' && matchedAction.aem_priority !== null && matchedAction.aem_priority >= 9) {
        await writeFinding({
          runId,
          organizationId: orgId,
          clientId,
          briefId,
          objectiveId: obj.id,
          platform,
          dimension: getDimension('AEM_PRIORITY_TOO_LOW'),
          severity: getSeverity('AEM_PRIORITY_TOO_LOW'),
          findingCode: 'AEM_PRIORITY_TOO_LOW',
          expected: { aem_priority: 'between 1 and 8' },
          observed: { aem_priority: matchedAction.aem_priority, conversion_name: matchedAction.name },
          narrative: buildNarrative('AEM_PRIORITY_TOO_LOW', {
            conversion_name: matchedAction.name,
            aem_priority: String(matchedAction.aem_priority),
          }),
          remediationHint: buildRemediation('AEM_PRIORITY_TOO_LOW', { conversion_name: matchedAction.name }),
        });
      }

      // ── Attribution Model (Google Ads only) ───────────────────────────────
      const expectedModel = platConfig['attribution_model'] as string | undefined;
      if (platform === 'google_ads' && expectedModel && matchedAction.attribution_model) {
        if (matchedAction.attribution_model.toLowerCase() !== expectedModel.toLowerCase()) {
          await writeFinding({
            runId,
            organizationId: orgId,
            clientId,
            briefId,
            objectiveId: obj.id,
            platform,
            dimension: getDimension('ATTRIBUTION_MODEL_MISMATCH'),
            severity: getSeverity('ATTRIBUTION_MODEL_MISMATCH'),
            findingCode: 'ATTRIBUTION_MODEL_MISMATCH',
            expected: { attribution_model: expectedModel },
            observed: { attribution_model: matchedAction.attribution_model, conversion_name: matchedAction.name },
            narrative: buildNarrative('ATTRIBUTION_MODEL_MISMATCH', {
              conversion_name: matchedAction.name,
              observed_model: matchedAction.attribution_model,
              expected_model: expectedModel,
            }),
            remediationHint: buildRemediation('ATTRIBUTION_MODEL_MISMATCH', {
              conversion_name: matchedAction.name,
              expected_model: expectedModel,
            }),
          });
        }
      }

      // ── Counting Type (Google Ads) ─────────────────────────────────────────
      const expectedCounting = platConfig['counting_type'] as string | undefined;
      if (platform === 'google_ads' && expectedCounting && matchedAction.counting_type) {
        if (matchedAction.counting_type.toLowerCase() !== expectedCounting.toLowerCase()) {
          await writeFinding({
            runId,
            organizationId: orgId,
            clientId,
            briefId,
            objectiveId: obj.id,
            platform,
            dimension: getDimension('COUNTING_TYPE_MISMATCH'),
            severity: getSeverity('COUNTING_TYPE_MISMATCH'),
            findingCode: 'COUNTING_TYPE_MISMATCH',
            expected: { counting_type: expectedCounting },
            observed: { counting_type: matchedAction.counting_type, conversion_name: matchedAction.name },
            narrative: buildNarrative('COUNTING_TYPE_MISMATCH', {
              conversion_name: matchedAction.name,
              observed_counting: matchedAction.counting_type,
              expected_counting: expectedCounting,
            }),
            remediationHint: buildRemediation('COUNTING_TYPE_MISMATCH', {
              conversion_name: matchedAction.name,
              expected_counting: expectedCounting,
            }),
          });
        }
      }

      // ── Lookback Window (Google Ads) ──────────────────────────────────────
      const minLookback = 30;
      if (
        platform === 'google_ads' &&
        matchedAction.click_lookback_days !== null &&
        matchedAction.click_lookback_days < minLookback
      ) {
        await writeFinding({
          runId,
          organizationId: orgId,
          clientId,
          briefId,
          objectiveId: obj.id,
          platform,
          dimension: getDimension('LOOKBACK_WINDOW_SHORT'),
          severity: getSeverity('LOOKBACK_WINDOW_SHORT'),
          findingCode: 'LOOKBACK_WINDOW_SHORT',
          expected: { click_lookback_days: minLookback },
          observed: { click_lookback_days: matchedAction.click_lookback_days, conversion_name: matchedAction.name },
          narrative: buildNarrative('LOOKBACK_WINDOW_SHORT', {
            conversion_name: matchedAction.name,
            observed_days: String(matchedAction.click_lookback_days),
            expected_days: String(minLookback),
          }),
          remediationHint: buildRemediation('LOOKBACK_WINDOW_SHORT', {
            conversion_name: matchedAction.name,
            expected_days: String(minLookback),
          }),
        });
      }

      // ── Value Settings (Google Ads, value-based bidding objectives) ────────
      const needsValueBidding = obj.proxy_event_required || platConfig['bidding'] === 'value_based';
      if (platform === 'google_ads' && needsValueBidding) {
        const vs = matchedAction.value_settings;
        const hasDefaultValue = vs && typeof vs.default_value === 'number' && vs.default_value > 0;
        if (!hasDefaultValue) {
          await writeFinding({
            runId,
            organizationId: orgId,
            clientId,
            briefId,
            objectiveId: obj.id,
            platform,
            dimension: getDimension('VALUE_SETTINGS_MISSING'),
            severity: getSeverity('VALUE_SETTINGS_MISSING'),
            findingCode: 'VALUE_SETTINGS_MISSING',
            expected: { value_settings: 'default_value > 0 required for value-based bidding' },
            observed: { value_settings: vs ?? null, conversion_name: matchedAction.name },
            narrative: buildNarrative('VALUE_SETTINGS_MISSING', { conversion_name: matchedAction.name }),
            remediationHint: buildRemediation('VALUE_SETTINGS_MISSING', { conversion_name: matchedAction.name }),
          });
        }
      }
    }
  }

  logger.info({ runId, briefId }, 'Config diff complete');
}
