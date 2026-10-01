/** google_tag_split_plans access (Google Tag Topology PRD §7.3). */
import { supabaseAdmin as supabase } from './supabase';

export type SplitPlanStatus = 'planned' | 'deployed_draft' | 'verified' | 'abandoned';

export interface SplitPlanRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  connection_id: string | null;
  topology_snapshot_ids: string[];
  delta: Record<string, unknown>;
  diff: Record<string, unknown>;
  status: SplitPlanStatus;
  deployed_workspace_id: string | null;
  deployed_at: string | null;
  verified_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, organization_id, client_id, connection_id, topology_snapshot_ids, delta, diff, status, deployed_workspace_id, deployed_at, verified_at, created_at';

export async function insertSplitPlan(args: {
  organizationId: string;
  clientId: string | null;
  connectionId: string | null;
  topologySnapshotIds: string[];
  delta: Record<string, unknown>;
  diff: Record<string, unknown>;
  status?: SplitPlanStatus;
  deployedWorkspaceId?: string | null;
}): Promise<SplitPlanRow> {
  const status = args.status ?? 'planned';
  const { data, error } = await supabase
    .from('google_tag_split_plans')
    .insert({
      organization_id: args.organizationId,
      client_id: args.clientId,
      connection_id: args.connectionId,
      topology_snapshot_ids: args.topologySnapshotIds,
      delta: args.delta,
      diff: args.diff,
      status,
      deployed_workspace_id: args.deployedWorkspaceId ?? null,
      deployed_at: status === 'deployed_draft' ? new Date().toISOString() : null,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`insertSplitPlan: ${error.message}`);
  return data as SplitPlanRow;
}

export async function getSplitPlan(id: string, organizationId: string): Promise<SplitPlanRow | null> {
  const { data, error } = await supabase
    .from('google_tag_split_plans')
    .select(COLUMNS)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`getSplitPlan: ${error.message}`);
  return (data as SplitPlanRow | null) ?? null;
}

export async function markSplitPlanDeployed(
  id: string,
  args: { delta: Record<string, unknown>; diff: Record<string, unknown>; workspaceId: string },
): Promise<SplitPlanRow> {
  const { data, error } = await supabase
    .from('google_tag_split_plans')
    .update({
      status: 'deployed_draft',
      delta: args.delta,
      diff: args.diff,
      deployed_workspace_id: args.workspaceId,
      deployed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`markSplitPlanDeployed: ${error.message}`);
  return data as SplitPlanRow;
}

export async function markSplitPlanVerified(id: string): Promise<SplitPlanRow> {
  const { data, error } = await supabase
    .from('google_tag_split_plans')
    .update({ status: 'verified', verified_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`markSplitPlanVerified: ${error.message}`);
  return data as SplitPlanRow;
}
