import { supabaseAdmin as supabase } from './supabase';
import type {
  DbStrategyBrief,
  DbStrategyObjective,
  DbStrategyObjectiveCampaign,
  CreateBriefInput,
  CreateObjectiveInput,
  UpdateObjectiveInput,
  SetObjectiveEvalInput,
  AddCampaignInput,
} from '@/types/strategy-db';

const HARD_CAP = 10;
const SOFT_CAP = 5;

// ── Briefs ────────────────────────────────────────────────────────────────────

export async function createBrief(
  orgId: string,
  input: CreateBriefInput,
): Promise<DbStrategyBrief> {
  const { data, error } = await supabase
    .from('strategy_briefs')
    .insert({
      organization_id: orgId,
      mode: 'multi',
      brief_name: input.brief_name ?? null,
      client_id: input.client_id ?? null,
      project_id: input.project_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DbStrategyBrief;
}

export async function getBriefWithObjectives(
  briefId: string,
  orgId: string,
): Promise<(DbStrategyBrief & { objectives: DbStrategyObjective[] }) | null> {
  const { data: brief, error: bErr } = await supabase
    .from('strategy_briefs')
    .select('*')
    .eq('id', briefId)
    .eq('organization_id', orgId)
    .single();
  if (bErr) throw bErr;
  if (!brief) return null;

  const { data: objectives, error: oErr } = await supabase
    .from('strategy_objectives')
    .select('*')
    .eq('brief_id', briefId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  if (oErr) throw oErr;

  return { ...(brief as DbStrategyBrief), objectives: (objectives ?? []) as DbStrategyObjective[] };
}

export async function listBriefs(orgId: string): Promise<DbStrategyBrief[]> {
  const { data, error } = await supabase
    .from('strategy_briefs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as DbStrategyBrief[];
}

export async function deleteBrief(briefId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_briefs')
    .delete()
    .eq('id', briefId)
    .eq('organization_id', orgId);
  if (error) throw error;
}

// ── Objectives ────────────────────────────────────────────────────────────────

export async function createObjective(
  orgId: string,
  input: CreateObjectiveInput,
): Promise<{ objective: DbStrategyObjective; atSoftCap: boolean }> {
  // Count existing objectives for this brief
  const { count, error: cErr } = await supabase
    .from('strategy_objectives')
    .select('id', { count: 'exact', head: true })
    .eq('brief_id', input.brief_id)
    .eq('organization_id', orgId);
  if (cErr) throw cErr;

  const current = count ?? 0;
  if (current >= HARD_CAP) {
    throw Object.assign(new Error(`Hard cap reached: a brief may have at most ${HARD_CAP} objectives.`), { code: 'HARD_CAP' });
  }

  // Case-insensitive name dedup within brief
  const { data: dup, error: dErr } = await supabase
    .from('strategy_objectives')
    .select('id')
    .eq('brief_id', input.brief_id)
    .eq('organization_id', orgId)
    .ilike('name', input.name)
    .maybeSingle();
  if (dErr) throw dErr;
  if (dup) {
    throw Object.assign(new Error(`An objective named "${input.name}" already exists in this brief.`), { code: 'DUPLICATE_NAME' });
  }

  const { data, error } = await supabase
    .from('strategy_objectives')
    .insert({
      brief_id: input.brief_id,
      organization_id: orgId,
      name: input.name,
      description: input.description ?? null,
      platforms: input.platforms ?? [],
      current_event: input.current_event ?? null,
      outcome_timing_days: input.outcome_timing_days ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;

  return { objective: data as DbStrategyObjective, atSoftCap: current + 1 >= SOFT_CAP };
}

export async function getObjective(
  objectiveId: string,
  orgId: string,
): Promise<DbStrategyObjective | null> {
  const { data, error } = await supabase
    .from('strategy_objectives')
    .select('*')
    .eq('id', objectiveId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data as DbStrategyObjective | null;
}

export async function updateObjective(
  objectiveId: string,
  orgId: string,
  input: UpdateObjectiveInput,
): Promise<DbStrategyObjective> {
  // Reject mutations to locked objectives
  const existing = await getObjective(objectiveId, orgId);
  if (!existing) throw Object.assign(new Error('Objective not found.'), { code: 'NOT_FOUND' });
  if (existing.locked) throw Object.assign(new Error('Locked objectives cannot be edited.'), { code: 'LOCKED' });

  // Name dedup if name is changing
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const { data: dup, error: dErr } = await supabase
      .from('strategy_objectives')
      .select('id')
      .eq('brief_id', existing.brief_id)
      .eq('organization_id', orgId)
      .ilike('name', input.name)
      .maybeSingle();
    if (dErr) throw dErr;
    if (dup) throw Object.assign(new Error(`An objective named "${input.name}" already exists in this brief.`), { code: 'DUPLICATE_NAME' });
  }

  const { data, error } = await supabase
    .from('strategy_objectives')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', objectiveId)
    .eq('organization_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data as DbStrategyObjective;
}

export async function deleteObjective(objectiveId: string, orgId: string): Promise<void> {
  const existing = await getObjective(objectiveId, orgId);
  if (!existing) throw Object.assign(new Error('Objective not found.'), { code: 'NOT_FOUND' });
  if (existing.locked) throw Object.assign(new Error('Locked objectives cannot be deleted.'), { code: 'LOCKED' });

  const { error } = await supabase
    .from('strategy_objectives')
    .delete()
    .eq('id', objectiveId)
    .eq('organization_id', orgId);
  if (error) throw error;
}

export async function setObjectiveEvaluation(
  objectiveId: string,
  orgId: string,
  eval_: SetObjectiveEvalInput,
): Promise<DbStrategyObjective> {
  const { data, error } = await supabase
    .from('strategy_objectives')
    .update({
      verdict: eval_.verdict,
      outcome_category: eval_.outcome_category,
      recommended_primary_event: eval_.recommended_primary_event ?? null,
      recommended_proxy_event: eval_.recommended_proxy_event ?? null,
      proxy_event_required: eval_.proxy_event_required,
      rationale: eval_.rationale,
      summary_markdown: eval_.summary_markdown,
      updated_at: new Date().toISOString(),
    })
    .eq('id', objectiveId)
    .eq('organization_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data as DbStrategyObjective;
}

export async function lockObjective(
  objectiveId: string,
  orgId: string,
): Promise<DbStrategyObjective> {
  const { data, error } = await supabase
    .from('strategy_objectives')
    .update({
      locked: true,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', objectiveId)
    .eq('organization_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data as DbStrategyObjective;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function addCampaign(
  objectiveId: string,
  orgId: string,
  input: AddCampaignInput,
): Promise<DbStrategyObjectiveCampaign> {
  const { data, error } = await supabase
    .from('strategy_objective_campaigns')
    .insert({
      objective_id: objectiveId,
      organization_id: orgId,
      platform: input.platform,
      campaign_name: input.campaign_name ?? null,
      budget: input.budget ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DbStrategyObjectiveCampaign;
}

export async function listCampaigns(
  objectiveId: string,
  orgId: string,
): Promise<DbStrategyObjectiveCampaign[]> {
  const { data, error } = await supabase
    .from('strategy_objective_campaigns')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbStrategyObjectiveCampaign[];
}
