/**
 * syncHealthCheck — gathers the raw signals evaluateOutcomeSyncAlert()
 * (dqmAlertEvaluator.ts) needs, org-wide across every enabled
 * outcome_source_configs row. docs/prd/crm-outcome-integration.md §10,
 * Sprint 8 (file renamed from crmSyncHealthCheck.ts,
 * docs/prd/universal-outcome-ingestion.md Phase 1).
 *
 * Deliberately impure (all DB reads) and kept separate from the pure
 * evaluator, matching this codebase's established split between probe/
 * gathering services and dqmAlertEvaluator.ts's own pure functions.
 *
 * Scoped to sync_enabled configs only — a deliberately paused config
 * shouldn't alert (its last real state is frozen, not degrading further).
 * Returns null when there is nothing enabled to evaluate at all, so the
 * caller (dqmOrchestrator.ts) can resolve any stale alert from before the
 * org's last config was disabled/deleted, exactly like sGTM's
 * totalCount === 0 case.
 */

import { supabaseAdmin } from '@/services/database/supabase';
import {
  listOutcomeSourceConfigsForOrg,
  listOutcomeStageMappings,
  getLatestDerivedValueSnapshots,
} from '@/services/database/outcomeQueries';
import type { OutcomeSyncAlertInput } from '@/services/dqm/dqmAlertEvaluator';

const IDENTITY_WINDOW_DAYS = 7;

interface OutcomeEventCounts {
  total: number;
  unresolved: number;
  skippedWindow: number;
}

async function countRecentOutcomeEvents(configIds: string[], sinceISO: string): Promise<OutcomeEventCounts> {
  const { data, error } = await supabaseAdmin
    .from('outcome_events')
    .select('identity_method, delivery_status')
    .in('config_id', configIds)
    .gte('created_at', sinceISO);

  if (error) throw new Error(`syncHealthCheck: failed to read recent outcome events: ${error.message}`);

  const rows = (data ?? []) as { identity_method: string; delivery_status: string }[];
  return {
    total: rows.length,
    unresolved: rows.filter((r) => r.identity_method === 'unresolved').length,
    skippedWindow: rows.filter((r) => r.delivery_status === 'skipped_window').length,
  };
}

async function hasExpiredSourceConnection(connectionIds: string[]): Promise<boolean> {
  if (connectionIds.length === 0) return false;
  const { data, error } = await supabaseAdmin
    .from('platform_connections')
    .select('id')
    .in('id', connectionIds)
    .in('status', ['expired', 'revoked'])
    .limit(1);

  if (error) throw new Error(`syncHealthCheck: failed to check connection status: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// A "bidding-primary" stage is one with a real destination configured —
// no dedicated column names this explicitly, so a stage is treated as
// bidding-primary if it has at least one platform destination set and is
// enabled. Terminal-won stages are excluded: CRM_AMOUNT always wins there
// (valueLadder.ts), so a withheld DERIVED snapshot never actually affects
// what gets delivered for that stage.
async function hasWithheldBiddingPrimaryStage(derivedModeConfigIds: string[]): Promise<boolean> {
  for (const configId of derivedModeConfigIds) {
    const [mappings, snapshots] = await Promise.all([
      listOutcomeStageMappings(configId),
      getLatestDerivedValueSnapshots(configId),
    ]);

    const withheldStages = new Set(
      snapshots.filter((s) => s.confidence === 'withheld').map((s) => s.crm_stage_id),
    );
    if (withheldStages.size === 0) continue;

    const hasBiddingPrimaryWithheld = mappings.some((m) =>
      m.enabled &&
      !m.is_terminal_won &&
      (m.google_conversion_action_id || m.meta_event_name || m.linkedin_conversion_id) &&
      withheldStages.has(m.crm_stage_id),
    );
    if (hasBiddingPrimaryWithheld) return true;
  }
  return false;
}

export async function computeOutcomeSyncHealthSignals(
  orgId: string,
  existingAlertActive: boolean,
): Promise<OutcomeSyncAlertInput | null> {
  const allConfigs = await listOutcomeSourceConfigsForOrg(orgId);
  const enabledConfigs = allConfigs.filter((c) => c.sync_enabled);
  if (enabledConfigs.length === 0) return null;

  const configIds = enabledConfigs.map((c) => c.id);
  // sync_enabled only ever applies to pull sources, which always have a
  // connection_id — the filter is defensive typing, not an expected drop
  // (a webhook config can never set sync_enabled in the first place).
  const connectionIds = Array.from(new Set(enabledConfigs.map((c) => c.connection_id).filter((id): id is string => !!id)));
  const derivedModeConfigIds = enabledConfigs.filter((c) => c.value_mode === 'DERIVED').map((c) => c.id);
  const consecutiveFailures = Math.max(...enabledConfigs.map((c) => c.consecutive_failures));

  const sinceISO = new Date(Date.now() - IDENTITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [tokenExpired, eventCounts, derivedWithheld] = await Promise.all([
    hasExpiredSourceConnection(connectionIds),
    countRecentOutcomeEvents(configIds, sinceISO),
    hasWithheldBiddingPrimaryStage(derivedModeConfigIds),
  ]);

  const attemptedTotal = eventCounts.total - eventCounts.unresolved;

  return {
    consecutiveFailures,
    tokenExpired,
    unresolvedIdentityRate7d: eventCounts.total > 0 ? (eventCounts.unresolved / eventCounts.total) * 100 : null,
    skippedWindowRate7d: attemptedTotal > 0 ? (eventCounts.skippedWindow / attemptedTotal) * 100 : null,
    derivedWithheldForBiddingPrimaryStage: derivedWithheld,
    existingAlertActive,
  };
}
