/**
 * Google Tag Topology PRD §7 (Sprint 4) — loads what a split plan needs for a
 * GTM connection (latest snapshot, client, topology) and builds the plan +
 * guidance. DB access lives here so the routes stay thin and the planner /
 * verification stay pure.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { parseContainerJson } from '@/services/gtm/containerParser';
import { getCurrentTopologyRows, type TopologyRecord } from '@/services/database/googleTagTopologyQueries';
import { computeTopologyVerdict, type TopologyVerdictResult } from './googleTagTopology';
import { planGoogleTagSplit, type SplitPlan } from '@/services/planning/generators/googleTagSplitPlanner';
import { buildSplitGuidance, type SplitGuidanceStep } from '@/services/ihc/googleTagSplitGuidance';
import type { GTMContainerSnapshot } from '@/types/audit';

export interface SplitPlanContext {
  connection: { id: string; client_id: string | null; account_id: string | null; container_id: string; auth_method: string };
  snapshot: { snapshot_at: string; container: GTMContainerSnapshot };
  clientId: string | null;
  secondaryDomains: string[];
  topologyRows: TopologyRecord[];
  topology: TopologyVerdictResult;
}

/** Returns null when the connection doesn't exist for this org, or has no snapshot yet. */
export async function loadSplitPlanContext(
  organizationId: string,
  connectionId: string,
): Promise<SplitPlanContext | 'no_connection' | 'no_snapshot'> {
  const { data: conn } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('id, client_id, account_id, container_id, auth_method')
    .eq('id', connectionId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!conn) return 'no_connection';
  const connection = conn as SplitPlanContext['connection'];

  const { data: snap } = await supabaseAdmin
    .from('gtm_container_snapshots')
    .select('container_json, snapshot_at')
    .eq('connection_id', connection.id)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) return 'no_snapshot';
  const s = snap as { container_json: Record<string, unknown>; snapshot_at: string };

  let secondaryDomains: string[] = [];
  let topologyRows: TopologyRecord[] = [];
  if (connection.client_id) {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('secondary_domains')
      .eq('id', connection.client_id)
      .maybeSingle();
    secondaryDomains = (client as { secondary_domains: string[] | null } | null)?.secondary_domains ?? [];
    topologyRows = await getCurrentTopologyRows(connection.client_id);
  }

  return {
    connection,
    snapshot: { snapshot_at: s.snapshot_at, container: parseContainerJson(s.container_json, 'gtm_api') },
    clientId: connection.client_id,
    secondaryDomains,
    topologyRows,
    topology: computeTopologyVerdict(topologyRows),
  };
}

export interface BuiltSplitPlan {
  plan: SplitPlan;
  guidance: SplitGuidanceStep[];
  topology: TopologyVerdictResult;
}

export function buildSplitPlan(ctx: SplitPlanContext): BuiltSplitPlan {
  const plan = planGoogleTagSplit({
    container: ctx.snapshot.container,
    topology: ctx.topology,
    secondaryDomains: ctx.secondaryDomains,
  });
  const guidance = buildSplitGuidance({
    combinedTagIds: ctx.topology.combined_tags.map((t) => t.google_tag_id),
    ga4Id: plan.destinations.ga4,
    adsId: plan.destinations.google_ads,
    secondaryDomains: ctx.secondaryDomains,
  });
  return { plan, guidance, topology: ctx.topology };
}
