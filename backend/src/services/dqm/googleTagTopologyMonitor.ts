/**
 * Google Tag Topology PRD §8.3 (Sprint 5) — monitors clients with a VERIFIED
 * split for regression: re-combination, or the Ads Google tag disappearing.
 *
 * Topology changes rarely, so this is gated to once per 24h per client (the
 * orchestrator loop runs every 15 minutes). The gate is the stored check row:
 * a client checked within 24h reuses its stored flags instead of recomputing,
 * so the rolled-up alert is still evaluated from every client's latest state.
 *
 * Only clients with a refreshable source are checked — an OAuth GTM connection
 * whose container Atlas keeps syncing. Runtime-only clients refresh their
 * topology on audit/CSE runs and are not polled here.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { parseContainerJson } from '@/services/gtm/containerParser';
import { getCurrentTopologyRows } from '@/services/database/googleTagTopologyQueries';
import { computeTopologyVerdict, type TopologyRow } from '@/services/google/googleTagTopology';
import { hasAdsDestination, hasSitewideAdsGoogleTag } from '@/services/validation/googleTagTopology';
import type { GoogleTagTopologyAlertInput } from './dqmAlertEvaluator';
import type { GTMContainerSnapshot } from '@/types/audit';
import logger from '@/utils/logger';

export const TOPOLOGY_CHECK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RegressionInput {
  verifiedAt: Date;
  rows: Array<TopologyRow & { observed_at: string }>;
  latestContainer: GTMContainerSnapshot | null;
  previousContainer: GTMContainerSnapshot | null;
}

export interface RegressionResult {
  recombined: boolean;
  adsTagLost: boolean;
}

/** Pure. Re-combination needs a post-verification observation showing it; an Ads tag is lost when the latest container has none but still uses Ads, or the previous one had it and the latest doesn't. */
export function detectTopologyRegression(input: RegressionInput): RegressionResult {
  const fresh = input.rows.filter((r) => new Date(r.observed_at).getTime() > input.verifiedAt.getTime());
  const verdict = computeTopologyVerdict(fresh).verdict;
  const recombined = verdict === 'COMBINED' || verdict === 'COMBINED_ADS_PRIMARY';

  let adsTagLost = false;
  if (input.latestContainer && !hasSitewideAdsGoogleTag(input.latestContainer)) {
    const stillUsesAds = hasAdsDestination(input.latestContainer);
    const previouslyHadTag = input.previousContainer ? hasSitewideAdsGoogleTag(input.previousContainer) : false;
    adsTagLost = stillUsesAds || previouslyHadTag;
  }
  return { recombined, adsTagLost };
}

interface VerifiedPlan {
  client_id: string;
  connection_id: string | null;
  verified_at: string | null;
}

interface StoredCheck {
  client_id: string;
  recombined: boolean;
  ads_tag_lost: boolean;
  checked_at: string;
}

/**
 * Evaluates every client of the org with a verified split. Returns null when
 * there is nothing to monitor (the orchestrator then resolves a stale alert).
 */
export async function computeGoogleTagTopologySignals(
  orgId: string,
  existingAlertActive: boolean,
  now: Date = new Date(),
): Promise<GoogleTagTopologyAlertInput | null> {
  const { data: plans } = await supabaseAdmin
    .from('google_tag_split_plans')
    .select('client_id, connection_id, verified_at')
    .eq('organization_id', orgId)
    .eq('status', 'verified')
    .not('client_id', 'is', null)
    .order('verified_at', { ascending: false });

  // Newest verified plan per client.
  const planByClient = new Map<string, VerifiedPlan>();
  for (const p of (plans ?? []) as VerifiedPlan[]) {
    if (!planByClient.has(p.client_id)) planByClient.set(p.client_id, p);
  }
  if (planByClient.size === 0) return null;

  const clientIds = [...planByClient.keys()];
  const { data: stored } = await supabaseAdmin
    .from('dqm_google_tag_topology_checks')
    .select('client_id, recombined, ads_tag_lost, checked_at')
    .eq('org_id', orgId)
    .in('client_id', clientIds)
    .order('checked_at', { ascending: false });
  const latestStored = new Map<string, StoredCheck>();
  for (const r of (stored ?? []) as StoredCheck[]) {
    if (!latestStored.has(r.client_id)) latestStored.set(r.client_id, r);
  }

  let monitored = 0;
  let recombinedCount = 0;
  let adsTagLostCount = 0;

  for (const [clientId, plan] of planByClient) {
    try {
      const prior = latestStored.get(clientId);
      let flags: RegressionResult;

      if (prior && now.getTime() - new Date(prior.checked_at).getTime() < TOPOLOGY_CHECK_MIN_INTERVAL_MS) {
        flags = { recombined: prior.recombined, adsTagLost: prior.ads_tag_lost };
      } else {
        const fresh = await checkClient(orgId, clientId, plan);
        if (!fresh) continue; // no refreshable source for this client
        flags = fresh;
      }

      monitored++;
      if (flags.recombined) recombinedCount++;
      if (flags.adsTagLost) adsTagLostCount++;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, clientId }, 'DQM: Google tag topology check failed for client');
    }
  }

  if (monitored === 0) return null;
  return { monitoredCount: monitored, recombinedCount, adsTagLostCount, existingAlertActive };
}

/** Runs and persists one client's check. Returns null when the client has no OAuth GTM connection with a snapshot. */
async function checkClient(orgId: string, clientId: string, plan: VerifiedPlan): Promise<RegressionResult | null> {
  if (!plan.connection_id) return null;

  const { data: conn } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('id, auth_method')
    .eq('id', plan.connection_id)
    .eq('client_id', clientId)
    .maybeSingle();
  if (!conn || (conn as { auth_method: string }).auth_method !== 'oauth') return null;

  const { data: snaps } = await supabaseAdmin
    .from('gtm_container_snapshots')
    .select('container_json')
    .eq('connection_id', plan.connection_id)
    .order('snapshot_at', { ascending: false })
    .limit(2);
  const list = (snaps ?? []) as Array<{ container_json: Record<string, unknown> }>;
  if (list.length === 0) return null;

  const rows = await getCurrentTopologyRows(clientId);
  const result = detectTopologyRegression({
    verifiedAt: new Date(plan.verified_at ?? 0),
    rows,
    latestContainer: parseContainerJson(list[0].container_json, 'gtm_api'),
    previousContainer: list[1] ? parseContainerJson(list[1].container_json, 'gtm_api') : null,
  });

  const topologyVerdict = computeTopologyVerdict(rows).verdict;
  const { error } = await supabaseAdmin.from('dqm_google_tag_topology_checks').insert({
    org_id: orgId,
    client_id: clientId,
    topology_verdict: topologyVerdict,
    recombined: result.recombined,
    ads_tag_lost: result.adsTagLost,
    check_status: result.adsTagLost ? 'fail' : result.recombined ? 'degraded' : 'pass',
  });
  if (error) throw new Error(`dqm_google_tag_topology_checks insert: ${error.message}`);
  return result;
}
