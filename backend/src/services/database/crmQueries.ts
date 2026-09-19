import { supabaseAdmin as supabase } from './supabase';
import type {
  CrmSyncConfig,
  CreateCrmSyncConfigInput,
  UpdateCrmSyncConfigInput,
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
