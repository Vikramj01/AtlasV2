import { supabaseAdmin } from './supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ObjectivePlatform = 'meta' | 'google' | 'linkedin' | 'tiktok' | 'other';
export type ObjectiveVerdict = 'keep' | 'add_proxy' | 'switch';
export type BriefMode = 'single' | 'multiple';

export interface ObjectiveCampaignRow {
  id: string;
  objective_id: string;
  organization_id: string;
  platform: ObjectivePlatform;
  campaign_identifier: string | null;
  notes: string | null;
  created_at: string;
}

export interface ObjectiveRow {
  id: string;
  brief_id: string;
  organization_id: string;
  name: string;
  priority: number;
  business_outcome: string;
  outcome_timing_days: number;
  current_event: string | null;
  platforms: ObjectivePlatform[];
  verdict: ObjectiveVerdict | null;
  recommended_primary_event: string | null;
  recommended_proxy_event: string | null;
  rationale: string | null;
  warnings: string[];
  locked: boolean;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  campaigns: ObjectiveCampaignRow[];
}

export interface BriefRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  mode: BriefMode;
  brief_name: string | null;
  version_no: number;
  locked_at: string | null;
  superseded_by: string | null;
  created_at: string;
  objectives: ObjectiveRow[];
}

// ── Soft / hard caps ───────────────────────────────────────────────────────────

const SOFT_CAP = 5;
const HARD_CAP = 10;

// ── Brief CRUD ─────────────────────────────────────────────────────────────────

export async function createBrief(
  orgId: string,
  mode: BriefMode,
  briefName?: string,
  clientId?: string,
  projectId?: string,
): Promise<BriefRow> {
  const { data, error } = await supabaseAdmin
    .from('strategy_briefs')
    .insert({
      organization_id: orgId,
      mode,
      brief_name: briefName ?? null,
      client_id: clientId ?? null,
      project_id: projectId ?? null,
      version_no: 1,
    })
    .select('id, organization_id, client_id, project_id, mode, brief_name, version_no, locked_at, superseded_by, created_at')
    .single();

  if (error) throw new Error(`Failed to create strategy brief: ${error.message}`);
  return { ...(data as Omit<BriefRow, 'objectives'>), objectives: [] };
}

export async function getBriefById(briefId: string): Promise<BriefRow | null> {
  const { data: brief, error: briefErr } = await supabaseAdmin
    .from('strategy_briefs')
    .select('id, organization_id, client_id, project_id, mode, brief_name, version_no, locked_at, superseded_by, created_at')
    .eq('id', briefId)
    .single();

  if (briefErr || !brief) return null;

  const { data: objectives, error: objErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select(`
      id, brief_id, organization_id, name, priority, business_outcome,
      outcome_timing_days, current_event, platforms, verdict,
      recommended_primary_event, recommended_proxy_event, rationale,
      warnings, locked, locked_at, created_at, updated_at,
      strategy_objective_campaigns (
        id, objective_id, organization_id, platform, campaign_identifier, notes, created_at
      )
    `)
    .eq('brief_id', briefId)
    .order('priority', { ascending: true });

  if (objErr) throw new Error(`Failed to fetch objectives: ${objErr.message}`);

  const mappedObjectives: ObjectiveRow[] = (objectives ?? []).map((o) => ({
    ...o,
    campaigns: (o.strategy_objective_campaigns ?? []) as ObjectiveCampaignRow[],
  }));

  return { ...(brief as Omit<BriefRow, 'objectives'>), objectives: mappedObjectives };
}

export async function updateBrief(
  briefId: string,
  fields: Partial<Pick<BriefRow, 'brief_name' | 'mode'>>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('strategy_briefs')
    .update(fields)
    .eq('id', briefId);

  if (error) throw new Error(`Failed to update strategy brief: ${error.message}`);
}

export async function lockBrief(briefId: string): Promise<void> {
  const { data: unlocked, error: checkErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id')
    .eq('brief_id', briefId)
    .eq('locked', false);

  if (checkErr) throw new Error(`Failed to check objectives: ${checkErr.message}`);
  if ((unlocked ?? []).length > 0) {
    throw Object.assign(new Error('All objectives must be locked before locking the brief.'), { status: 400 });
  }

  const { data: objs, error: countErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id')
    .eq('brief_id', briefId);

  if (countErr) throw new Error(`Failed to count objectives: ${countErr.message}`);
  if ((objs ?? []).length === 0) {
    throw Object.assign(new Error('A brief must have at least one locked objective.'), { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('strategy_briefs')
    .update({ locked_at: new Date().toISOString() })
    .eq('id', briefId);

  if (error) throw new Error(`Failed to lock strategy brief: ${error.message}`);
}

export async function listBriefs(orgId: string): Promise<BriefRow[]> {
  const { data, error } = await supabaseAdmin
    .from('strategy_briefs')
    .select('id, organization_id, client_id, project_id, mode, brief_name, version_no, locked_at, superseded_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to list strategy briefs: ${error.message}`);
  return (data ?? []).map((b) => ({ ...(b as Omit<BriefRow, 'objectives'>), objectives: [] }));
}

// ── Objective CRUD ─────────────────────────────────────────────────────────────

export interface AddObjectiveInput {
  name: string;
  business_outcome: string;
  outcome_timing_days: number;
  current_event?: string;
  platforms: ObjectivePlatform[];
  priority?: number;
}

export interface AddObjectiveResult {
  objective: ObjectiveRow;
  soft_cap_warning: boolean;
}

export async function addObjective(
  briefId: string,
  orgId: string,
  input: AddObjectiveInput,
): Promise<AddObjectiveResult> {
  // Count existing objectives
  const { count, error: countErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('*', { count: 'exact', head: true })
    .eq('brief_id', briefId);

  if (countErr) throw new Error(`Failed to count objectives: ${countErr.message}`);
  const existing = count ?? 0;

  if (existing >= HARD_CAP) {
    throw Object.assign(
      new Error('Create a new Atlas project for additional objectives.'),
      { status: 400 },
    );
  }

  // Duplicate name check (case-insensitive)
  const { data: nameCheck, error: nameErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id')
    .eq('brief_id', briefId)
    .ilike('name', input.name.trim());

  if (nameErr) throw new Error(`Failed to check duplicate names: ${nameErr.message}`);
  if ((nameCheck ?? []).length > 0) {
    throw Object.assign(new Error('An objective with this name already exists on this brief.'), { status: 400 });
  }

  // Determine next priority if not supplied
  const priority = input.priority ?? existing + 1;

  const { data, error } = await supabaseAdmin
    .from('strategy_objectives')
    .insert({
      brief_id: briefId,
      organization_id: orgId,
      name: input.name.trim(),
      priority,
      business_outcome: input.business_outcome,
      outcome_timing_days: input.outcome_timing_days,
      current_event: input.current_event ?? null,
      platforms: input.platforms,
    })
    .select(`
      id, brief_id, organization_id, name, priority, business_outcome,
      outcome_timing_days, current_event, platforms, verdict,
      recommended_primary_event, recommended_proxy_event, rationale,
      warnings, locked, locked_at, created_at, updated_at
    `)
    .single();

  if (error) throw new Error(`Failed to add objective: ${error.message}`);

  const objective: ObjectiveRow = { ...(data as Omit<ObjectiveRow, 'campaigns'>), campaigns: [] };
  return { objective, soft_cap_warning: existing + 1 > SOFT_CAP };
}

export async function updateObjective(
  objectiveId: string,
  fields: Partial<Pick<AddObjectiveInput, 'name' | 'business_outcome' | 'outcome_timing_days' | 'current_event' | 'platforms' | 'priority'>>,
): Promise<void> {
  const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if (fields.name) update.name = (fields.name as string).trim();

  const { error } = await supabaseAdmin
    .from('strategy_objectives')
    .update(update)
    .eq('id', objectiveId)
    .eq('locked', false);

  if (error) throw new Error(`Failed to update objective: ${error.message}`);
}

export async function deleteObjective(objectiveId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('strategy_objectives')
    .delete()
    .eq('id', objectiveId);

  if (error) throw new Error(`Failed to delete objective: ${error.message}`);
}

export interface ObjectiveVerdictData {
  verdict: ObjectiveVerdict;
  recommended_primary_event: string;
  recommended_proxy_event: string | null;
  rationale: string;
  warnings: string[];
}

export async function persistObjectiveVerdict(
  objectiveId: string,
  verdictData: ObjectiveVerdictData,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('strategy_objectives')
    .update({
      verdict: verdictData.verdict,
      recommended_primary_event: verdictData.recommended_primary_event,
      recommended_proxy_event: verdictData.recommended_proxy_event ?? null,
      rationale: verdictData.rationale,
      warnings: verdictData.warnings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', objectiveId);

  if (error) throw new Error(`Failed to persist objective verdict: ${error.message}`);
}

export async function lockObjective(objectiveId: string): Promise<void> {
  const { data: obj, error: fetchErr } = await supabaseAdmin
    .from('strategy_objectives')
    .select('verdict')
    .eq('id', objectiveId)
    .single();

  if (fetchErr || !obj) {
    throw Object.assign(new Error('Objective not found.'), { status: 404 });
  }
  if (!(obj as { verdict: string | null }).verdict) {
    throw Object.assign(new Error('Objective must be evaluated before it can be locked.'), { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('strategy_objectives')
    .update({ locked: true, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', objectiveId);

  if (error) throw new Error(`Failed to lock objective: ${error.message}`);
}

export async function getObjectiveById(objectiveId: string): Promise<ObjectiveRow | null> {
  const { data, error } = await supabaseAdmin
    .from('strategy_objectives')
    .select(`
      id, brief_id, organization_id, name, priority, business_outcome,
      outcome_timing_days, current_event, platforms, verdict,
      recommended_primary_event, recommended_proxy_event, rationale,
      warnings, locked, locked_at, created_at, updated_at,
      strategy_objective_campaigns (
        id, objective_id, organization_id, platform, campaign_identifier, notes, created_at
      )
    `)
    .eq('id', objectiveId)
    .single();

  if (error || !data) return null;
  return {
    ...(data as Omit<ObjectiveRow, 'campaigns'>),
    campaigns: (data.strategy_objective_campaigns ?? []) as ObjectiveCampaignRow[],
  };
}

// ── Campaign CRUD ──────────────────────────────────────────────────────────────

export interface AddCampaignInput {
  platform: ObjectivePlatform;
  campaign_identifier?: string;
  notes?: string;
}

export async function addCampaign(
  objectiveId: string,
  orgId: string,
  input: AddCampaignInput,
): Promise<ObjectiveCampaignRow> {
  const { data, error } = await supabaseAdmin
    .from('strategy_objective_campaigns')
    .insert({
      objective_id: objectiveId,
      organization_id: orgId,
      platform: input.platform,
      campaign_identifier: input.campaign_identifier ?? null,
      notes: input.notes ?? null,
    })
    .select('id, objective_id, organization_id, platform, campaign_identifier, notes, created_at')
    .single();

  if (error) throw new Error(`Failed to add campaign: ${error.message}`);
  return data as ObjectiveCampaignRow;
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('strategy_objective_campaigns')
    .delete()
    .eq('id', campaignId);

  if (error) throw new Error(`Failed to delete campaign: ${error.message}`);
}

export async function getCampaignOrgId(campaignId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('strategy_objective_campaigns')
    .select('organization_id')
    .eq('id', campaignId)
    .single();

  if (error || !data) return null;
  return (data as { organization_id: string }).organization_id;
}
