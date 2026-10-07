/** Junk conversion gate persistence (GA4 Admin / L11 / Junk Gate PRD Part C). Service-role only. */
import { supabaseAdmin as supabase } from './supabase';
import type { JunkGateConfig, JunkVerdict, RuleHit } from '@/services/capi/junkGate/types';

/** capi_providers → identity config → client. null when the provider has no identity config. */
export async function getClientIdForProvider(providerConfigId: string): Promise<string | null> {
  const { data: provider } = await supabase
    .from('capi_providers').select('identity_config_id').eq('id', providerConfigId).maybeSingle();
  const identityConfigId = (provider as { identity_config_id: string | null } | null)?.identity_config_id;
  if (!identityConfigId) return null;
  const { data: identity } = await supabase
    .from('client_identity_configs').select('client_id').eq('id', identityConfigId).maybeSingle();
  return (identity as { client_id: string } | null)?.client_id ?? null;
}

interface ConfigRow {
  mode: JunkGateConfig['mode'];
  event_names: string[] | null;
  rule_flags: JunkGateConfig['rule_flags'] | null;
  thresholds: Partial<JunkGateConfig['thresholds']> | null;
}

/** The client's stored config, or null when none was ever saved (the caller applies defaults). */
export async function getJunkGateConfigRow(clientId: string): Promise<ConfigRow | null> {
  const { data } = await supabase
    .from('junk_gate_configs').select('mode, event_names, rule_flags, thresholds').eq('client_id', clientId).maybeSingle();
  return (data as ConfigRow | null) ?? null;
}

export interface NewObservedRecord {
  organization_id: string;
  client_id: string | null;
  atlas_event_id: string;
  event_name: string;
  event_time: string;
  provider_config_id: string;
  verdict: JunkVerdict;
  rule_hits: RuleHit[];
}

/**
 * One record per Atlas event: UNIQUE (organization_id, atlas_event_id) makes a racing second
 * insert a no-op, after which the existing row is read back. Returns the row id and whether
 * THIS call created it.
 */
export async function insertObservedRecord(rec: NewObservedRecord): Promise<{ id: string; created: boolean } | null> {
  const { data, error } = await supabase
    .from('conversion_holds')
    .upsert(
      {
        organization_id: rec.organization_id,
        client_id: rec.client_id,
        atlas_event_id: rec.atlas_event_id,
        event_name: rec.event_name,
        event_time: rec.event_time,
        provider_config_ids: [rec.provider_config_id],
        verdict: rec.verdict,
        rule_hits: rec.rule_hits,
        status: 'observed',
      },
      { onConflict: 'organization_id,atlas_event_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`conversion_holds insert failed: ${error.message}`);
  if (data && data.length > 0) return { id: (data[0] as { id: string }).id, created: true };

  const { data: existing } = await supabase
    .from('conversion_holds').select('id')
    .eq('organization_id', rec.organization_id).eq('atlas_event_id', rec.atlas_event_id).maybeSingle();
  return existing ? { id: (existing as { id: string }).id, created: false } : null;
}

/** Adds a provider config to an existing record's bound-for list (idempotent). */
export async function appendProviderConfigId(recordId: string, providerConfigId: string): Promise<void> {
  const { data } = await supabase.from('conversion_holds').select('provider_config_ids').eq('id', recordId).maybeSingle();
  const current = (data as { provider_config_ids: string[] } | null)?.provider_config_ids ?? [];
  if (current.includes(providerConfigId)) return;
  const { error } = await supabase
    .from('conversion_holds').update({ provider_config_ids: [...current, providerConfigId] }).eq('id', recordId);
  if (error) throw new Error(`conversion_holds update failed: ${error.message}`);
}
