/**
 * Meta Conversions API — Delivery Service
 *
 * Sends events to the Meta Graph API endpoint:
 *   POST https://graph.facebook.com/v19.0/{pixel_id}/events
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → MetaEventPayload
 *   - Batch delivery (up to 1,000 events per request per Meta's limits)
 *   - Test event mode (test_event_code)
 *   - Error parsing from Meta's error envelope
 *
 * Reference:
 *   https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  MetaCredentials,
  MetaEventPayload,
  TestResult,
  DeliveryResult,
} from '@/types/capi';

// ── User param completeness ───────────────────────────────────────────────────

/** Warn if event has fewer than 6 user params (Meta's recommended minimum). */
export interface UserParamCompletenessResult {
  param_count: number;
  missing_recommended: string[];
}

export function checkUserParamCompleteness(
  identifiers: HashedIdentifier[],
  hasUserAgent: boolean,
  hasIpAddress: boolean,
): UserParamCompletenessResult | null {
  const RECOMMENDED = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id', 'fbc', 'fbp', 'client_user_agent', 'client_ip_address'] as const;
  const TYPE_MAP: Record<string, string> = { email: 'em', phone: 'ph', fn: 'fn', ln: 'ln', ct: 'ct', st: 'st', zp: 'zp', country: 'country', external_id: 'external_id', fbc: 'fbc', fbp: 'fbp' };
  const present = new Set(identifiers.map(id => TYPE_MAP[id.type] ?? id.type));
  if (hasUserAgent) present.add('client_user_agent');
  if (hasIpAddress) present.add('client_ip_address');
  if (present.size >= 6) return null;
  return {
    param_count: present.size,
    missing_recommended: RECOMMENDED.filter(p => !present.has(p)),
  };
}

const META_API_VERSION = 'v19.0';
const META_API_BASE = 'https://graph.facebook.com';

// ── Payload formatting ────────────────────────────────────────────────────────

/**
 * Format a single AtlasEvent + hashed identifiers into a Meta event data object.
 * Accepts optional DPO (Data Processing Options) to include for US privacy compliance.
 */
export function formatMetaEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  dpo?: { options: string[]; country: number; state: number },
): MetaEventPayload['data'][number] {
  // Build user_data from hashed identifiers
  const userData: MetaEventPayload['data'][number]['user_data'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       (userData.em ??= []).push(id.value); break;
      case 'phone':       (userData.ph ??= []).push(id.value); break;
      case 'fn':          (userData.fn ??= []).push(id.value); break;
      case 'ln':          (userData.ln ??= []).push(id.value); break;
      case 'ct':          (userData.ct ??= []).push(id.value); break;
      case 'st':          (userData.st ??= []).push(id.value); break;
      case 'zp':          (userData.zp ??= []).push(id.value); break;
      case 'country':     (userData.country ??= []).push(id.value); break;
      case 'external_id': (userData.external_id ??= []).push(id.value); break;
      case 'fbc':         userData.fbc = id.value; break;
      case 'fbp':         userData.fbp = id.value; break;
    }
  }

  if (event.user_data.client_user_agent) {
    userData.client_user_agent = event.user_data.client_user_agent;
  }
  if (event.user_data.client_ip_address) {
    userData.client_ip_address = event.user_data.client_ip_address;
  }

  const metaEvent: MetaEventPayload['data'][number] = {
    event_name: mapping.provider_event,
    event_time: event.event_time,
    event_id: event.event_id || randomUUID(),
    event_source_url: event.event_source_url,
    action_source: event.action_source,
    user_data: userData,
  };

  if (event.custom_data) {
    metaEvent.custom_data = {
      value:        event.custom_data.value,
      currency:     event.custom_data.currency,
      content_type: event.custom_data.content_type,
      content_ids:  event.custom_data.content_ids,
      order_id:     event.custom_data.order_id,
      num_items:    event.custom_data.num_items,
    };
  }

  if (dpo?.options?.length) {
    metaEvent.data_processing_options         = dpo.options;
    metaEvent.data_processing_options_country = dpo.country;
    metaEvent.data_processing_options_state   = dpo.state;
  }

  return metaEvent;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Send a batch of formatted events to the Meta Conversions API.
 * Returns one DeliveryResult per event.
 */
export async function sendMetaEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: MetaCredentials,
  testEventCode?: string | null,
  dpo?: { options: string[]; country: number; state: number },
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const metaMappingFor = (eventName: string): EventMapping =>
    mappings.find(m => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: eventName };

  const formattedData = events.map((e, i) =>
    formatMetaEvent(e, metaMappingFor(e.event_name), identifiersPerEvent[i] ?? [], dpo)
  );

  const payload: Record<string, unknown> = {
    data: formattedData,
    access_token: creds.access_token,
  };
  if (testEventCode) payload.test_event_code = testEventCode;

  const url = `${META_API_BASE}/${META_API_VERSION}/${creds.pixel_id}/events`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as MetaAPIResponse;

  if (!res.ok) {
    const errMsg = body.error?.message ?? `HTTP ${res.status}`;
    const errCode = String(body.error?.code ?? 'DELIVERY_FAILED');
    return events.map(e => ({
      event_id: e.event_id,
      status: 'failed' as const,
      provider_response: body,
      error_code: errCode,
      error_message: errMsg,
    }));
  }

  // Meta returns events_received on success
  return events.map(e => ({
    event_id: e.event_id,
    status: 'delivered' as const,
    provider_response: body,
  }));
}

// ── Test event ────────────────────────────────────────────────────────────────

export async function sendMetaTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: MetaCredentials,
  testCode: string,
): Promise<TestResult> {
  const formatted = formatMetaEvent(event, mapping, identifiers);

  const payload = {
    data: [formatted],
    test_event_code: testCode,
    access_token: creds.access_token,
  };

  const url = `${META_API_BASE}/${META_API_VERSION}/${creds.pixel_id}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as MetaAPIResponse;

  if (!res.ok) {
    return {
      status: 'failed',
      provider_response: body,
      error: body.error?.message ?? `HTTP ${res.status}`,
    };
  }

  return {
    status: 'success',
    provider_response: body,
    emq_estimate: undefined, // EMQ requires /diagnostics endpoint (Sprint 4)
  };
}

// ── Credential validation ─────────────────────────────────────────────────────

/**
 * Validate Meta credentials by making a lightweight read request to the
 * pixel's stats endpoint.
 */
export async function validateMetaCredentials(creds: MetaCredentials): Promise<{ valid: boolean; error?: string }> {
  const url = `${META_API_BASE}/${META_API_VERSION}/${creds.pixel_id}?fields=id,name&access_token=${encodeURIComponent(creds.access_token)}`;

  try {
    const res = await fetch(url);
    const body = await res.json() as MetaAPIResponse;

    if (!res.ok) {
      return { valid: false, error: body.error?.message ?? `HTTP ${res.status}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaAPIResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}
