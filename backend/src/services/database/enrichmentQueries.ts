import { supabaseAdmin as supabase } from './supabase';
import type {
  ClientIdentityConfig,
  SignalEnrichmentConfig,
  SaveIdentityConfigRequest,
  SaveSignalEnrichmentRequest,
} from '@/types/enrichment';

// ─── Client Identity Config ───────────────────────────────────────────────────

export async function getClientIdentityConfig(clientId: string): Promise<ClientIdentityConfig | null> {
  const { data } = await supabase
    .from('client_identity_configs')
    .select('*')
    .eq('client_id', clientId)
    .single();
  return (data as ClientIdentityConfig | null);
}

export async function upsertClientIdentityConfig(
  req: SaveIdentityConfigRequest,
): Promise<ClientIdentityConfig> {
  const payload = {
    client_id: req.client_id,
    email_field: req.email_field ?? null,
    phone_field: req.phone_field ?? null,
    first_name_field: req.first_name_field ?? null,
    last_name_field: req.last_name_field ?? null,
    postal_code_field: req.postal_code_field ?? null,
    country_field: req.country_field ?? null,
    external_id_field: req.external_id_field ?? null,
    ...(req.fbc_field !== undefined && { fbc_field: req.fbc_field }),
    ...(req.fbp_field !== undefined && { fbp_field: req.fbp_field }),
    ...(req.gclid_field !== undefined && { gclid_field: req.gclid_field }),
    ...(req.wbraid_field !== undefined && { wbraid_field: req.wbraid_field }),
    ...(req.gbraid_field !== undefined && { gbraid_field: req.gbraid_field }),
    ...(req.auto_capture_ip !== undefined && { auto_capture_ip: req.auto_capture_ip }),
    ...(req.auto_capture_ua !== undefined && { auto_capture_ua: req.auto_capture_ua }),
    ...(req.enabled_identifiers !== undefined && { enabled_identifiers: req.enabled_identifiers }),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('client_identity_configs')
    .upsert(payload, { onConflict: 'client_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert identity config: ${error.message}`);
  return data as ClientIdentityConfig;
}

export async function updateIdentityConfigScore(
  clientId: string,
  score: number,
): Promise<void> {
  await supabase
    .from('client_identity_configs')
    .update({ identity_score: score, validated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('client_id', clientId);
}

// ─── Signal Enrichment Configs ────────────────────────────────────────────────

export async function listSignalEnrichmentConfigs(
  deploymentId: string,
): Promise<SignalEnrichmentConfig[]> {
  const { data, error } = await supabase
    .from('signal_enrichment_configs')
    .select('*')
    .eq('deployment_id', deploymentId)
    .order('signal_key');
  if (error) throw new Error(`Failed to list enrichment configs: ${error.message}`);
  return (data ?? []) as SignalEnrichmentConfig[];
}

export async function getSignalEnrichmentConfig(
  deploymentId: string,
  signalKey: string,
): Promise<SignalEnrichmentConfig | null> {
  const { data } = await supabase
    .from('signal_enrichment_configs')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('signal_key', signalKey)
    .single();
  return (data as SignalEnrichmentConfig | null);
}

export async function upsertSignalEnrichmentConfig(
  req: SaveSignalEnrichmentRequest,
  score?: number,
  warnings?: unknown[],
): Promise<SignalEnrichmentConfig> {
  const payload = {
    deployment_id: req.deployment_id,
    signal_key: req.signal_key,
    value_field: req.value_config?.field ?? null,
    value_includes_tax: req.value_config?.includes_tax ?? false,
    value_includes_shipping: req.value_config?.includes_shipping ?? false,
    currency_field: req.currency_config?.mode === 'dynamic' ? (req.currency_config.field ?? null) : null,
    currency_static: req.currency_config?.mode === 'static' ? (req.currency_config.static_value ?? null) : null,
    dedup_id_field: req.dedup_config?.field ?? null,
    content_ids_field: req.content_config?.ids_field ?? null,
    content_ids_path_type: req.content_config?.ids_path_type ?? 'array',
    num_items_field: req.content_config?.num_items_field ?? null,
    enabled_for_meta: req.enabled_for_meta,
    enabled_for_google: req.enabled_for_google,
    ...(score !== undefined && { validation_score: score, validated_at: new Date().toISOString() }),
    ...(warnings !== undefined && { validation_warnings: warnings }),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('signal_enrichment_configs')
    .upsert(payload, { onConflict: 'deployment_id,signal_key' })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert signal enrichment config: ${error.message}`);

  // Map flat DB columns back to nested config shape
  const row = data as Record<string, unknown>;
  return dbRowToSignalEnrichmentConfig(row);
}

// ─── DB Row → Type Mapping ────────────────────────────────────────────────────

export function dbRowToSignalEnrichmentConfig(row: Record<string, unknown>): SignalEnrichmentConfig {
  return {
    id: row.id as string,
    deployment_id: row.deployment_id as string,
    signal_key: row.signal_key as string,
    value_config: row.value_field
      ? {
          field: row.value_field as string,
          includes_tax: Boolean(row.value_includes_tax),
          includes_shipping: Boolean(row.value_includes_shipping),
        }
      : null,
    currency_config: row.currency_static
      ? { mode: 'static', static_value: row.currency_static as string }
      : row.currency_field
      ? { mode: 'dynamic', field: row.currency_field as string }
      : null,
    dedup_config: row.dedup_id_field
      ? { field: row.dedup_id_field as string }
      : null,
    content_config: row.content_ids_field
      ? {
          ids_field: row.content_ids_field as string,
          ids_path_type: (row.content_ids_path_type as 'array' | 'string' | 'nested') ?? 'array',
          num_items_field: (row.num_items_field as string | undefined) ?? undefined,
        }
      : null,
    enabled_for_meta: Boolean(row.enabled_for_meta),
    enabled_for_google: Boolean(row.enabled_for_google),
    validated_at: (row.validated_at as string | null) ?? null,
    validation_score: (row.validation_score as number | null) ?? null,
    validation_warnings: (row.validation_warnings as import('@/types/enrichment').EnrichmentWarning[]) ?? [],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
