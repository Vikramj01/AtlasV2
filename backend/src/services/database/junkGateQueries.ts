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
  action_junk: JunkGateConfig['action_junk'] | null;
  action_suspect: JunkGateConfig['action_suspect'] | null;
  hold_timeout_hours: number | null;
  timeout_action: JunkGateConfig['timeout_action'] | null;
}

/** The client's stored config, or null when none was ever saved (the caller applies defaults). */
export async function getJunkGateConfigRow(clientId: string): Promise<ConfigRow | null> {
  const { data } = await supabase
    .from('junk_gate_configs').select('mode, event_names, rule_flags, thresholds, action_junk, action_suspect, hold_timeout_hours, timeout_action').eq('client_id', clientId).maybeSingle();
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
  /** Default 'observed'. C2: 'held' (with expiry + class) or 'rejected' (a drop action). */
  status?: 'observed' | 'held' | 'rejected';
  expires_at?: string | null;
  delivery_class?: 'server_only' | 'hybrid' | null;
  timeout_hours_applied?: number | null;
  timeout_clamped?: boolean;
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
        status: rec.status ?? 'observed',
        expires_at: rec.expires_at ?? null,
        delivery_class: rec.delivery_class ?? null,
        timeout_hours_applied: rec.timeout_hours_applied ?? null,
        timeout_clamped: rec.timeout_clamped ?? false,
        ...(rec.status === 'rejected' ? { decided_at: new Date().toISOString() } : {}),
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

// ── C2: enforce mode, holds, targets ─────────────────────────────────────────

export interface FullGateConfigRow {
  client_id: string;
  mode: JunkGateConfig['mode'];
  event_names: string[];
  rule_flags: JunkGateConfig['rule_flags'];
  thresholds: Partial<JunkGateConfig['thresholds']>;
  action_junk: JunkGateConfig['action_junk'];
  action_suspect: JunkGateConfig['action_suspect'];
  hold_timeout_hours: number;
  timeout_action: JunkGateConfig['timeout_action'];
}

export async function upsertJunkGateConfig(organizationId: string, row: Partial<FullGateConfigRow> & { client_id: string }): Promise<FullGateConfigRow> {
  const { data, error } = await supabase
    .from('junk_gate_configs')
    .upsert({ organization_id: organizationId, ...row, updated_at: new Date().toISOString() }, { onConflict: 'client_id' })
    .select('*').single();
  if (error) throw new Error(`junk_gate_configs upsert failed: ${error.message}`);
  return data as FullGateConfigRow;
}

export async function getFullJunkGateConfig(organizationId: string, clientId: string): Promise<FullGateConfigRow | null> {
  const { data } = await supabase
    .from('junk_gate_configs').select('*').eq('organization_id', organizationId).eq('client_id', clientId).maybeSingle();
  return (data as FullGateConfigRow | null) ?? null;
}

export async function clientBelongsToOrg(organizationId: string, clientId: string): Promise<boolean> {
  const { data } = await supabase.from('clients').select('id').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
  return !!data;
}

export interface HoldRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  atlas_event_id: string;
  event_name: string;
  event_time: string;
  provider_config_ids: string[];
  verdict: JunkVerdict;
  rule_hits: RuleHit[];
  delivery_class: 'server_only' | 'hybrid' | null;
  status: 'observed' | 'held' | 'released' | 'rejected' | 'auto_released' | 'auto_dropped';
  expires_at: string | null;
  timeout_hours_applied: number | null;
  timeout_clamped: boolean;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

const HOLD_COLUMNS = 'id, organization_id, client_id, atlas_event_id, event_name, event_time, provider_config_ids, verdict, rule_hits, delivery_class, status, expires_at, timeout_hours_applied, timeout_clamped, decided_by, decided_at, created_at';

export async function getHold(organizationId: string, holdId: string): Promise<HoldRow | null> {
  const { data } = await supabase.from('conversion_holds').select(HOLD_COLUMNS).eq('id', holdId).eq('organization_id', organizationId).maybeSingle();
  return (data as HoldRow | null) ?? null;
}

export async function getHoldById(holdId: string): Promise<HoldRow | null> {
  const { data } = await supabase.from('conversion_holds').select(HOLD_COLUMNS).eq('id', holdId).maybeSingle();
  return (data as HoldRow | null) ?? null;
}

export interface HoldFilters {
  client_id?: string;
  status?: HoldRow['status'][];
  verdict?: JunkVerdict;
  limit?: number;
  offset?: number;
}

/** Excludes clean rows (they exist as a metrics denominator, not a review queue). */
export async function listHolds(organizationId: string, f: HoldFilters): Promise<{ rows: HoldRow[]; total: number }> {
  let q = supabase.from('conversion_holds').select(HOLD_COLUMNS, { count: 'exact' })
    .eq('organization_id', organizationId).neq('verdict', 'clean');
  if (f.client_id) q = q.eq('client_id', f.client_id);
  if (f.status && f.status.length > 0) q = q.in('status', f.status);
  if (f.verdict) q = q.eq('verdict', f.verdict);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(`conversion_holds list failed: ${error.message}`);
  return { rows: (data ?? []) as HoldRow[], total: count ?? 0 };
}

/**
 * Atomic terminal transition: only a row that is still `held` moves, so two concurrent
 * release/reject/timeout attempts can never both win. Returns the row, or null if it lost.
 */
export async function transitionHold(
  holdId: string,
  to: 'released' | 'rejected' | 'auto_released' | 'auto_dropped',
  decidedBy: string | null,
  organizationId?: string,
): Promise<HoldRow | null> {
  let q = supabase.from('conversion_holds')
    .update({ status: to, decided_by: decidedBy, decided_at: new Date().toISOString(), payload_encrypted: null })
    .eq('id', holdId).eq('status', 'held');
  if (organizationId) q = q.eq('organization_id', organizationId);
  const { data, error } = await q.select(HOLD_COLUMNS);
  if (error) throw new Error(`conversion_holds transition failed: ${error.message}`);
  return data && data.length > 0 ? (data[0] as HoldRow) : null;
}

export async function updateHoldBinding(
  holdId: string,
  patch: { expires_at?: string; timeout_hours_applied?: number; timeout_clamped?: boolean; delivery_class?: 'server_only' | 'hybrid' },
): Promise<void> {
  const { error } = await supabase.from('conversion_holds').update(patch).eq('id', holdId).eq('status', 'held');
  if (error) throw new Error(`conversion_holds update failed: ${error.message}`);
}

export interface HoldTargetRow {
  id: string;
  hold_id: string;
  organization_id: string;
  provider_config_id: string;
  provider: string;
  capi_event_id: string | null;
  payload_encrypted: string | null;
  status: 'pending' | 'delivered' | 'failed' | 'dropped';
}

export async function insertHoldTarget(t: {
  hold_id: string; organization_id: string; provider_config_id: string; provider: string;
  capi_event_id: string | null; payload_encrypted: string;
}): Promise<void> {
  const { error } = await supabase.from('conversion_hold_targets')
    .upsert(t, { onConflict: 'hold_id,provider_config_id', ignoreDuplicates: true });
  if (error) throw new Error(`conversion_hold_targets insert failed: ${error.message}`);
}

export async function listHoldTargets(holdId: string): Promise<HoldTargetRow[]> {
  const { data, error } = await supabase.from('conversion_hold_targets')
    .select('id, hold_id, organization_id, provider_config_id, provider, capi_event_id, payload_encrypted, status')
    .eq('hold_id', holdId);
  if (error) throw new Error(`conversion_hold_targets list failed: ${error.message}`);
  return (data ?? []) as HoldTargetRow[];
}

/** Terminal for the target: the payload is always nulled, whatever the outcome. */
export async function finishHoldTarget(
  targetId: string, status: 'delivered' | 'failed' | 'dropped', detail?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('conversion_hold_targets')
    .update({ status, payload_encrypted: null, result_detail: detail ?? null, finished_at: new Date().toISOString() })
    .eq('id', targetId);
  if (error) throw new Error(`conversion_hold_targets finish failed: ${error.message}`);
}

/** Open holds past their expiry — the sweeper's query. */
export async function listExpiredHoldIds(nowIso: string, limit = 100): Promise<string[]> {
  const { data, error } = await supabase.from('conversion_holds').select('id')
    .eq('status', 'held').lte('expires_at', nowIso).order('expires_at', { ascending: true }).limit(limit);
  if (error) throw new Error(`conversion_holds expiry list failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

export async function markCapiEventStatus(capiEventId: string, status: 'junk_rejected' | 'junk_released'): Promise<void> {
  const { error } = await supabase.from('capi_events').update({ status }).eq('id', capiEventId);
  if (error) throw new Error(`capi_events update failed: ${error.message}`);
}

/** The CAPI provider types bound to a client (through its identity config) — for the clamp preview. */
export async function listProvidersForClient(organizationId: string, clientId: string): Promise<Array<'meta' | 'google' | 'tiktok' | 'linkedin' | 'snapchat' | 'amazon' | 'microsoft' | 'openai'>> {
  const { data: identity } = await supabase.from('client_identity_configs').select('id').eq('client_id', clientId).maybeSingle();
  const identityId = (identity as { id: string } | null)?.id;
  if (!identityId) return [];
  const { data } = await supabase.from('capi_providers').select('provider')
    .eq('organization_id', organizationId).eq('identity_config_id', identityId);
  return ((data ?? []) as Array<{ provider: 'meta' }>).map((r) => r.provider);
}
