/**
 * CAPI Module — Database CRUD layer.
 *
 * All CAPI DB access goes through these functions.
 * Follows the same pattern as planningQueries.ts.
 *
 * Tables: capi_providers, capi_events, capi_event_queue
 *
 * NOTE: credentials are stored encrypted via credentials.ts.
 * This layer stores/retrieves the raw encrypted blob — callers that need
 * to USE credentials must call safeDecryptCredentials() themselves.
 */

import { supabaseAdmin as supabase } from './supabase';
import { encryptCredentials } from '@/services/capi/credentials';
import type {
  CAPIProviderConfig,
  CAPIProvider,
  CAPIProviderStatus,
  CAPIEvent,
  CAPIEventStatus,
  EventMapping,
  IdentifierConfig,
  DedupConfig,
  ProviderCredentials,
  ProviderDashboardResponse,
  AtlasEvent,
  HashedIdentifier,
} from '@/types/capi';

// ── Provider CRUD ─────────────────────────────────────────────────────────────

export interface CreateProviderInput {
  project_id: string;
  organization_id: string;
  provider: CAPIProvider;
  credentials: ProviderCredentials;
  event_mapping: EventMapping[];
  identifier_config: IdentifierConfig;
  dedup_config: DedupConfig;
  test_event_code?: string;
  data_processing_options?: string[];
  data_processing_options_country?: number;
  data_processing_options_state?: number;
}

export async function createProvider(input: CreateProviderInput): Promise<CAPIProviderConfig> {
  const { data, error } = await supabase
    .from('capi_providers')
    .insert({
      project_id: input.project_id,
      organization_id: input.organization_id,
      provider: input.provider,
      status: 'draft',
      credentials: encryptCredentials(input.credentials),
      event_mapping: input.event_mapping,
      identifier_config: input.identifier_config,
      dedup_config: input.dedup_config,
      test_event_code: input.test_event_code ?? null,
      data_processing_options: input.data_processing_options ?? [],
      data_processing_options_country: input.data_processing_options_country ?? 0,
      data_processing_options_state: input.data_processing_options_state ?? 0,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create CAPI provider: ${error.message}`);
  return data as CAPIProviderConfig;
}

export async function getProvider(
  providerId: string,
  organizationId: string,
): Promise<CAPIProviderConfig | null> {
  const { data, error } = await supabase
    .from('capi_providers')
    .select('*')
    .eq('id', providerId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get CAPI provider: ${error.message}`);
  return data as CAPIProviderConfig | null;
}

export async function listProviders(organizationId: string): Promise<CAPIProviderConfig[]> {
  const { data, error } = await supabase
    .from('capi_providers')
    .select('id, project_id, organization_id, provider, status, event_mapping, identifier_config, dedup_config, test_event_code, error_message, last_health_check, events_sent_total, events_failed_total, created_at, updated_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list CAPI providers: ${error.message}`);
  // credentials column intentionally excluded from list (contains encrypted blob)
  return (data ?? []) as CAPIProviderConfig[];
}

export async function updateProviderStatus(
  providerId: string,
  status: CAPIProviderStatus,
  errorMessage?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('capi_providers')
    .update({
      status,
      error_message: errorMessage ?? null,
      last_health_check: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', providerId);

  if (error) throw new Error(`Failed to update provider status: ${error.message}`);
}

export async function updateProviderCredentials(
  providerId: string,
  credentials: ProviderCredentials,
): Promise<void> {
  const { error } = await supabase
    .from('capi_providers')
    .update({
      credentials: encryptCredentials(credentials),
      updated_at: new Date().toISOString(),
    })
    .eq('id', providerId);

  if (error) throw new Error(`Failed to update provider credentials: ${error.message}`);
}

export async function updateProviderConfig(
  providerId: string,
  update: Partial<Pick<CAPIProviderConfig, 'event_mapping' | 'identifier_config' | 'dedup_config' | 'test_event_code' | 'data_processing_options' | 'data_processing_options_country' | 'data_processing_options_state'>>,
): Promise<CAPIProviderConfig> {
  const { data, error } = await supabase
    .from('capi_providers')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', providerId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update provider config: ${error.message}`);
  return data as CAPIProviderConfig;
}

export async function incrementProviderCounters(
  providerId: string,
  sent: number,
  failed: number,
): Promise<void> {
  // Use RPC or raw SQL via supabase rpc for atomic increment
  const { error } = await supabase.rpc('increment_capi_counters', {
    p_provider_id: providerId,
    p_sent: sent,
    p_failed: failed,
  });

  if (error) {
    // Fallback: non-atomic update (acceptable for MVP)
    const { data: current } = await supabase
      .from('capi_providers')
      .select('events_sent_total, events_failed_total')
      .eq('id', providerId)
      .single();

    if (current) {
      await supabase
        .from('capi_providers')
        .update({
          events_sent_total: (current.events_sent_total ?? 0) + sent,
          events_failed_total: (current.events_failed_total ?? 0) + failed,
        })
        .eq('id', providerId);
    }
  }
}

export async function deleteProvider(
  providerId: string,
  organizationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('capi_providers')
    .delete()
    .eq('id', providerId)
    .eq('organization_id', organizationId);

  if (error) throw new Error(`Failed to delete CAPI provider: ${error.message}`);
}

// ── CAPI Events ───────────────────────────────────────────────────────────────

export interface CreateCAPIEventInput {
  provider_config_id: string;
  organization_id: string;
  atlas_event_id: string;
  provider_event_name: string;
  status: CAPIEventStatus;
  consent_state: Record<string, string>;
  identifiers_sent: number;
  event_value?: number | null;
  event_currency?: string | null;
  provider_response?: unknown;
  error_code?: string | null;
  error_message?: string | null;
}

export async function createCAPIEvent(input: CreateCAPIEventInput): Promise<CAPIEvent> {
  const { data, error } = await supabase
    .from('capi_events')
    .insert({
      ...input,
      retry_count: 0,
      processed_at: new Date().toISOString(),
      delivered_at: input.status === 'delivered' ? new Date().toISOString() : null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create CAPI event: ${error.message}`);
  return data as CAPIEvent;
}

export async function updateCAPIEventStatus(
  eventId: string,
  status: CAPIEventStatus,
  providerResponse?: unknown,
  errorCode?: string | null,
  errorMessage?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('capi_events')
    .update({
      status,
      provider_response: providerResponse ?? null,
      error_code: errorCode ?? null,
      error_message: errorMessage ?? null,
      delivered_at: status === 'delivered' ? new Date().toISOString() : undefined,
    })
    .eq('id', eventId);

  if (error) throw new Error(`Failed to update CAPI event status: ${error.message}`);
}

// ── Deduplication check ───────────────────────────────────────────────────────

/**
 * Returns true if an event with this atlas_event_id was already processed
 * within the dedup window for this provider.
 */
export async function isEventDuplicate(
  providerConfigId: string,
  atlasEventId: string,
  dedupWindowMinutes: number,
): Promise<boolean> {
  const since = new Date();
  since.setMinutes(since.getMinutes() - dedupWindowMinutes);

  const { data, error } = await supabase
    .from('capi_events')
    .select('id')
    .eq('provider_config_id', providerConfigId)
    .eq('atlas_event_id', atlasEventId)
    .gte('processed_at', since.toISOString())
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check event dedup: ${error.message}`);
  return data !== null;
}

// ── Dashboard analytics ───────────────────────────────────────────────────────

export async function getProviderDashboard(
  providerConfigId: string,
  organizationId: string,
  days = 30,
): Promise<ProviderDashboardResponse> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('capi_events')
    .select('provider_event_name, status, event_value, processed_at')
    .eq('provider_config_id', providerConfigId)
    .eq('organization_id', organizationId)
    .gte('processed_at', since.toISOString());

  if (error) throw new Error(`Failed to get provider dashboard: ${error.message}`);

  const events = data ?? [];
  const total = events.length;
  const delivered = events.filter(e => e.status === 'delivered').length;
  const failed = events.filter(e => e.status === 'delivery_failed').length;
  const blocked = events.filter(e => e.status === 'consent_blocked').length;

  // By event name
  const byEvent = new Map<string, { count: number; success: number }>();
  for (const e of events) {
    const cur = byEvent.get(e.provider_event_name) ?? { count: 0, success: 0 };
    byEvent.set(e.provider_event_name, {
      count: cur.count + 1,
      success: cur.success + (e.status === 'delivered' ? 1 : 0),
    });
  }

  // By day
  const byDay = new Map<string, { delivered: number; failed: number }>();
  for (const e of events) {
    const day = (e.processed_at as string).slice(0, 10);
    const cur = byDay.get(day) ?? { delivered: 0, failed: 0 };
    byDay.set(day, {
      delivered: cur.delivered + (e.status === 'delivered' ? 1 : 0),
      failed: cur.failed + (e.status === 'delivery_failed' ? 1 : 0),
    });
  }

  return {
    total_events: total,
    delivered,
    failed,
    blocked_by_consent: blocked,
    avg_emq: null,
    delivery_rate: total > 0 ? Math.round((delivered / total) * 100) : 0,
    avg_latency_ms: 0, // populated in Sprint 4 with actual timing data
    by_event: Array.from(byEvent.entries()).map(([event_name, { count, success }]) => ({
      event_name,
      count,
      success_rate: count > 0 ? Math.round((success / count) * 100) : 0,
    })),
    by_day: Array.from(byDay.entries())
      .map(([date, { delivered: d, failed: f }]) => ({ date, delivered: d, failed: f }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface QueuedEventPayload {
  event: AtlasEvent;
  identifiers: HashedIdentifier[];
  provider_event_name: string;
}

export async function enqueueEvent(
  providerConfigId: string,
  organizationId: string,
  payload: QueuedEventPayload,
): Promise<string> {
  const { data, error } = await supabase
    .from('capi_event_queue')
    .insert({
      provider_config_id: providerConfigId,
      organization_id: organizationId,
      payload,
      status: 'pending',
      retry_count: 0,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to enqueue CAPI event: ${error.message}`);
  return (data as { id: string }).id;
}
