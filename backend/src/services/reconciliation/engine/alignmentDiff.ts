import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation, getSeverity, getDimension } from '../codes/findingCodes';
import logger from '@/utils/logger';

interface CampaignGoal {
  id: string;
  connection_id: string;
  external_campaign_id: string;
  campaign_name: string;
  status: string | null;
  optimization_goal: string | null;
  selective_optimization_actions: string[] | null;
  custom_event_type: string | null;
}

interface ConversionAction {
  external_id: string;
  name: string;
}

interface StrategyObjective {
  id: string;
  name: string;
  recommended_primary_event: string | null;
  conversion_tier: string | null;
  platforms: string[];
}

export async function runAlignmentDiff(
  runId: string,
  clientId: string,
  briefId: string,
  orgId: string,
): Promise<void> {
  // Load locked objectives for this brief
  const { data: objectives, error: objErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id, name, recommended_primary_event, conversion_tier, platforms')
    .eq('brief_id', briefId)
    .eq('locked', true);

  if (objErr || !objectives?.length) {
    logger.info({ briefId }, 'No locked objectives found for alignment diff');
    return;
  }

  // Load active connections for this client
  const { data: connections, error: connErr } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform, account_id, account_label')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .in('platform', ['google_ads', 'meta']);

  if (connErr || !connections?.length) return;

  for (const conn of connections) {
    const platform = conn.platform as string;
    const connectionId = conn.id as string;

    // Load conversion actions for this connection
    const { data: actions } = await supabaseAdmin
      .from('platform_conversion_actions')
      .select('external_id, name')
      .eq('connection_id', connectionId);

    const actionsByName = new Map<string, ConversionAction>();
    const actionsById = new Map<string, ConversionAction>();
    for (const a of (actions ?? []) as ConversionAction[]) {
      actionsByName.set(a.name.toLowerCase(), a);
      actionsById.set(a.external_id, a);
    }

    // Load active campaigns for this connection
    const { data: campaigns } = await supabaseAdmin
      .from('platform_campaign_goals')
      .select('id, connection_id, external_campaign_id, campaign_name, status, optimization_goal, selective_optimization_actions, custom_event_type')
      .eq('connection_id', connectionId)
      .not('status', 'eq', 'REMOVED');

    const activeCampaigns = (campaigns ?? []) as CampaignGoal[];

    for (const obj of objectives as StrategyObjective[]) {
      // Only check platforms this objective covers
      if (!obj.platforms.includes(platform)) continue;

      const primaryEventName = obj.recommended_primary_event;
      if (!primaryEventName) continue;

      const expectedAction = actionsByName.get(primaryEventName.toLowerCase());

      // ── MISSING_PRIMARY_CONVERSION ─────────────────────────────────────────
      if (!expectedAction) {
        await writeFinding({
          runId,
          organizationId: orgId,
          clientId,
          briefId,
          objectiveId: obj.id,
          platform,
          dimension: getDimension('MISSING_PRIMARY_CONVERSION'),
          severity: getSeverity('MISSING_PRIMARY_CONVERSION'),
          findingCode: 'MISSING_PRIMARY_CONVERSION',
          expected: { conversion_name: primaryEventName },
          observed: { message: `No conversion action named "${primaryEventName}" found in account` },
          narrative: buildNarrative('MISSING_PRIMARY_CONVERSION', {
            expected_conversion: primaryEventName,
            objective_name: obj.name,
            platform,
          }),
          remediationHint: buildRemediation('MISSING_PRIMARY_CONVERSION', {
            expected_conversion: primaryEventName,
            platform,
          }),
        });
        continue;
      }

      const expectedExternalId = expectedAction.external_id;

      // Check each active campaign that runs on this platform
      for (const campaign of activeCampaigns) {
        if (campaign.status === 'PAUSED' || campaign.status === 'REMOVED') continue;

        const campaignOptActions = campaign.selective_optimization_actions ?? [];

        // ── SUPPRESSION_USED_AS_PRIMARY ────────────────────────────────────
        if (obj.conversion_tier === 'suppression') {
          const isUsedAsPrimary =
            campaignOptActions.includes(expectedExternalId) ||
            campaign.custom_event_type === primaryEventName.toUpperCase();

          if (isUsedAsPrimary) {
            await writeFinding({
              runId,
              organizationId: orgId,
              clientId,
              briefId,
              objectiveId: obj.id,
              platform,
              dimension: getDimension('SUPPRESSION_USED_AS_PRIMARY'),
              severity: getSeverity('SUPPRESSION_USED_AS_PRIMARY'),
              findingCode: 'SUPPRESSION_USED_AS_PRIMARY',
              expected: { conversion_tier: 'suppression', should_not_be_primary: true },
              observed: { campaign_name: campaign.campaign_name, optimising_on: primaryEventName },
              narrative: buildNarrative('SUPPRESSION_USED_AS_PRIMARY', {
                conversion_name: primaryEventName,
                campaign_name: campaign.campaign_name,
              }),
              remediationHint: buildRemediation('SUPPRESSION_USED_AS_PRIMARY', {
                conversion_name: primaryEventName,
                campaign_name: campaign.campaign_name,
              }),
            });
          }
          continue;
        }

        // ── WRONG_PRIMARY_CONVERSION ───────────────────────────────────────
        // Only flag if the campaign is explicitly optimising for conversions
        // (OFFSITE_CONVERSIONS for Meta, or has selective_optimization_actions for Google)
        const isConversionCampaign =
          campaign.optimization_goal === 'OFFSITE_CONVERSIONS' ||
          campaignOptActions.length > 0;

        if (!isConversionCampaign) continue;

        const hasCorrectConversion =
          campaignOptActions.includes(expectedExternalId) ||
          campaign.custom_event_type === primaryEventName.toUpperCase();

        if (!hasCorrectConversion && campaignOptActions.length > 0) {
          const observedNames = campaignOptActions
            .map((id) => actionsById.get(id)?.name ?? id)
            .join(', ');

          await writeFinding({
            runId,
            organizationId: orgId,
            clientId,
            briefId,
            objectiveId: obj.id,
            platform,
            dimension: getDimension('WRONG_PRIMARY_CONVERSION'),
            severity: getSeverity('WRONG_PRIMARY_CONVERSION'),
            findingCode: 'WRONG_PRIMARY_CONVERSION',
            expected: { conversion_name: primaryEventName, external_id: expectedExternalId },
            observed: {
              campaign_name: campaign.campaign_name,
              optimising_on: observedNames || campaign.custom_event_type,
            },
            narrative: buildNarrative('WRONG_PRIMARY_CONVERSION', {
              campaign_name: campaign.campaign_name,
              observed_conversion: observedNames || campaign.custom_event_type ?? 'unknown',
              expected_conversion: primaryEventName,
            }),
            remediationHint: buildRemediation('WRONG_PRIMARY_CONVERSION', {
              campaign_name: campaign.campaign_name,
              expected_conversion: primaryEventName,
            }),
          });
        }
      }
    }
  }

  logger.info({ runId, briefId }, 'Alignment diff complete');
}
