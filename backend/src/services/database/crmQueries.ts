import { supabaseAdmin as supabase } from './supabase';
import type {
  CrmSyncConfig,
  CreateCrmSyncConfigInput,
  UpdateCrmSyncConfigInput,
  CrmStageMapping,
  StageMappingInput,
} from '@/types/crm';

export async function listCrmSyncConfigsForOrg(orgId: string): Promise<CrmSyncConfig[]> {
  const { data, error } = await supabase
    .from('crm_sync_configs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listCrmSyncConfigsForOrg: ${error.message}`);
  return (data ?? []) as unknown as CrmSyncConfig[];
}

export async function getCrmSyncConfigById(id: string, orgId: string): Promise<CrmSyncConfig | null> {
  const { data, error } = await supabase
    .from('crm_sync_configs')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) throw new Error(`getCrmSyncConfigById: ${error.message}`);
  return data as unknown as CrmSyncConfig | null;
}

export async function createCrmSyncConfig(
  orgId: string,
  input: CreateCrmSyncConfigInput,
): Promise<CrmSyncConfig> {
  const { data, error } = await supabase
    .from('crm_sync_configs')
    .insert({
      organization_id: orgId,
      client_id: input.client_id,
      connection_id: input.connection_id,
      provider: input.provider,
      pipeline_id: input.pipeline_id ?? null,
      tracked_object: input.tracked_object ?? 'deal',
      identity_property_map: input.identity_property_map ?? {},
      value_mode: input.value_mode ?? 'DECLARED',
      default_currency: input.default_currency ?? 'USD',
      backfill_days: input.backfill_days ?? 30,
    })
    .select('*')
    .single();

  if (error) throw new Error(`createCrmSyncConfig: ${error.message}`);
  return data as unknown as CrmSyncConfig;
}

export async function updateCrmSyncConfig(
  id: string,
  orgId: string,
  patch: UpdateCrmSyncConfigInput,
): Promise<CrmSyncConfig> {
  const { data, error } = await supabase
    .from('crm_sync_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`updateCrmSyncConfig: ${error.message}`);
  return data as unknown as CrmSyncConfig;
}

export async function deleteCrmSyncConfig(id: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('crm_sync_configs')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) throw new Error(`deleteCrmSyncConfig: ${error.message}`);
}

// ── Stage mappings (the ladder itself, §5.3) ────────────────────────────────────

export async function listCrmStageMappings(configId: string): Promise<CrmStageMapping[]> {
  const { data, error } = await supabase
    .from('crm_stage_mappings')
    .select('*')
    .eq('config_id', configId)
    .order('stage_order');

  if (error) throw new Error(`listCrmStageMappings: ${error.message}`);
  return (data ?? []) as unknown as CrmStageMapping[];
}

// Replaces the whole ladder in one call (PRD §11's PUT /configs/:id/stage-mappings
// — "Replace the ladder"). Upserts by (config_id, crm_stage_id) rather than a
// delete-then-reinsert so an edited-but-kept stage keeps its row id — once
// Sprint 4/5 start writing crm_outcome_events.mapping_id against these rows,
// a delete+reinsert would orphan those references (ON DELETE SET NULL) on
// every ladder edit; upserting avoids that from day one.
export async function replaceCrmStageMappings(
  configId: string,
  orgId: string,
  mappings: StageMappingInput[],
): Promise<CrmStageMapping[]> {
  const incomingStageIds = mappings.map((m) => m.crm_stage_id);

  if (mappings.length > 0) {
    const { error: upsertErr } = await supabase
      .from('crm_stage_mappings')
      .upsert(
        mappings.map((m) => ({
          organization_id: orgId,
          config_id: configId,
          crm_stage_id: m.crm_stage_id,
          crm_stage_label: m.crm_stage_label ?? '',
          stage_order: m.stage_order,
          atlas_event_name: m.atlas_event_name,
          is_terminal_won: m.is_terminal_won ?? false,
          is_terminal_lost: m.is_terminal_lost ?? false,
          declared_value: m.declared_value ?? null,
          currency: m.currency ?? null,
          google_conversion_action_id: m.google_conversion_action_id ?? null,
          meta_event_name: m.meta_event_name ?? null,
          linkedin_conversion_id: m.linkedin_conversion_id ?? null,
          enabled: m.enabled ?? true,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'config_id,crm_stage_id' },
      );

    if (upsertErr) throw new Error(`replaceCrmStageMappings (upsert): ${upsertErr.message}`);
  }

  // Prune stages the operator removed from the ladder.
  let deleteQuery = supabase
    .from('crm_stage_mappings')
    .delete()
    .eq('config_id', configId);
  deleteQuery = incomingStageIds.length > 0
    ? deleteQuery.not('crm_stage_id', 'in', `(${incomingStageIds.map((id) => `"${id}"`).join(',')})`)
    : deleteQuery;
  const { error: deleteErr } = await deleteQuery;
  if (deleteErr) throw new Error(`replaceCrmStageMappings (prune): ${deleteErr.message}`);

  return listCrmStageMappings(configId);
}

// Real query, always zero until Sprint 4/5's orchestrator/delivery exist —
// per Implementation Rule 12, this stays wired to the actual table rather
// than a fabricated placeholder count.
export async function countRecentOutcomesByMapping(configId: string): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('crm_outcome_events')
    .select('mapping_id')
    .eq('config_id', configId)
    .eq('delivery_status', 'delivered')
    .gte('created_at', since);

  if (error) throw new Error(`countRecentOutcomesByMapping: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { mapping_id: string | null }[]) {
    if (!row.mapping_id) continue;
    counts[row.mapping_id] = (counts[row.mapping_id] ?? 0) + 1;
  }
  return counts;
}
