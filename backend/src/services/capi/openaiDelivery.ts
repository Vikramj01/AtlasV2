/**
 * OpenAI / OAIQ Conversions API — Delivery Service
 *
 * ChatGPT ads reached Europe on 24 Aug 2026 — after this codebase's
 * knowledge cutoff, so the exact production endpoint below is a best-effort
 * placeholder following the shape OAIQ's own docs describe (server-side
 * event-ID dedup + hashed identifiers, paired with a first-party `__oppref`
 * pixel cookie captured client-side). Confirm the endpoint against OAIQ's
 * published docs before enabling live delivery.
 *
 * Scope note (per ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md B5):
 * instrumentation + dedup only — do not build or market incrementality/MMM
 * features here. The platform has none (no multi-day attribution windows,
 * no lift studies, 24-48hr reporting lag).
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → OAIQ conversion event
 *   - Dedup via Redis (30-day window, keyed by event_id — OAIQ dedups
 *     server-side on event ID, same model as LinkedIn/TikTok)
 *   - Credential validation via a live test-event call
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  OpenAICredentials,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getOpenAIDedupEntry } from './dedupStore';
import logger from '@/utils/logger';

const OAIQ_API_BASE = 'https://api.oaiq.openai.com/v1';

function oaiqHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

export interface OAIQConversionEvent {
  publisher_id: string;
  event_name: string;
  event_time: number;
  event_id: string;
  oppref?: string; // first-party __oppref cookie value, when captured
  user_data: {
    hashed_email?: string;
    hashed_phone?: string;
    external_id?: string;
    ip?: string;
    user_agent?: string;
  };
  value?: number;
  currency?: string;
}

/**
 * Build a single OAIQ conversion event from an AtlasEvent + hashed identifiers.
 * `oppref` is read from user_data.external_id when the client-side pixel has
 * stored the `__oppref` cookie value there — Atlas has no dedicated oppref
 * field today, so this degrades to PII-only matching until one is added.
 */
export function formatOpenAIEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  creds: OpenAICredentials,
): OAIQConversionEvent {
  const userData: OAIQConversionEvent['user_data'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       userData.hashed_email = id.value; break;
      case 'phone':       userData.hashed_phone  = id.value; break;
      case 'external_id': userData.external_id   = id.value; break;
    }
  }
  if (event.user_data.client_ip_address) userData.ip = event.user_data.client_ip_address;
  if (event.user_data.client_user_agent) userData.user_agent = event.user_data.client_user_agent;

  const payload: OAIQConversionEvent = {
    publisher_id: creds.publisher_id,
    event_name: mapping.provider_event ?? event.event_name,
    event_time: event.event_time,
    event_id: event.event_id,
    user_data: userData,
  };

  if (event.custom_data?.value !== undefined) {
    payload.value = event.custom_data.value;
    payload.currency = event.custom_data.currency?.toUpperCase();
  }

  return payload;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

interface OAIQResponse {
  status?: string;
  errors?: Array<{ code: string; message: string }>;
}

export async function sendOpenAIEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: OpenAICredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const fallbackId = e.event_id || randomUUID();
      if (!providerId) return { entry: null, dedupeId: fallbackId };
      const entry = await getOpenAIDedupEntry(providerId, fallbackId, e.event_name);
      return { entry, dedupeId: fallbackId };
    }),
  );

  const mappingFor = (eventName: string): EventMapping =>
    mappings.find((m) => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: eventName };

  const conversionEvents = events.map((e, i) =>
    formatOpenAIEvent(e, mappingFor(e.event_name), identifiersPerEvent[i] ?? [], creds),
  );

  let res: Response;
  let body: OAIQResponse;

  try {
    res = await fetch(`${OAIQ_API_BASE}/conversions`, {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({ events: conversionEvents }),
    });
    body = await res.json() as OAIQResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    logger.error({ provider: 'openai', err: errMsg }, 'OAIQ Conversions API network error');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: null,
      error_code: 'NETWORK_ERROR',
      error_message: errMsg,
    }));
  }

  if (!res.ok) {
    const firstErr = body.errors?.[0];
    const errCode = firstErr?.code ?? `HTTP_${res.status}`;
    const errMsg = firstErr?.message ?? `OAIQ Conversions API HTTP ${res.status}`;
    logger.warn({ provider: 'openai', status: res.status, code: errCode }, 'OAIQ Conversions API request failed');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: body,
      error_code: errCode,
      error_message: errMsg,
      dedup_status: providerId ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss' : undefined,
    }));
  }

  return events.map((e, i) => ({
    event_id: dedupResults[i].dedupeId,
    status: 'delivered' as const,
    provider_response: body,
    dedup_status: providerId ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss' : undefined,
    dedup_key: providerId ? `${providerId}:${dedupResults[i].dedupeId}:${e.event_name}` : undefined,
    dedup_matched_at: dedupResults[i].entry ? new Date().toISOString() : undefined,
  }));
}

// ── Test event ────────────────────────────────────────────────────────────────

export async function sendOpenAITestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: OpenAICredentials,
): Promise<TestResult> {
  const formatted = formatOpenAIEvent(event, mapping, identifiers, creds);

  try {
    const res = await fetch(`${OAIQ_API_BASE}/conversions`, {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({ events: [formatted], test_mode: true }),
    });

    const body = await res.json() as OAIQResponse;

    if (!res.ok) {
      const firstErr = body.errors?.[0];
      return {
        status: 'failed',
        provider_response: body,
        error: firstErr?.message ?? `OAIQ Conversions API HTTP ${res.status}`,
      };
    }

    return { status: 'success', provider_response: body };
  } catch (err) {
    return {
      status: 'failed',
      provider_response: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// ── Credential validation ─────────────────────────────────────────────────────

export async function validateOpenAICredentials(
  creds: OpenAICredentials,
): Promise<ValidationResult> {
  const required = ['publisher_id', 'api_key'] as const;
  const missing = required.filter((k) => !creds[k]);
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  try {
    const res = await fetch(`${OAIQ_API_BASE}/conversions`, {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({
        events: [{
          publisher_id: creds.publisher_id,
          event_name: 'ViewContent',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `atlas-validate-${randomUUID()}`,
          user_data: {},
        }],
        test_mode: true,
      }),
    });

    if (res.ok) return { valid: true };

    const body = await res.json().catch(() => ({})) as { message?: string };
    return {
      valid: false,
      error: body.message ?? `Invalid OAIQ credentials (HTTP ${res.status})`,
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
