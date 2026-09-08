/**
 * OpenAI / OAIQ Conversions API — Delivery Service
 *
 * ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part A (A-W1) — corrects the endpoint,
 * auth scheme and event schema below, which predated OpenAI's public spec
 * and were flagged in this file's own header as a best-effort placeholder
 * ("Confirm the endpoint against OAIQ's published docs before enabling
 * live delivery"). Direct WebFetch to developers.openai.com/ads was
 * blocked by this environment's network egress policy, so this was
 * verified instead by cross-referencing ~8 independent third-party
 * integration guides (agency blogs, a GTM community tag, and a reverse-ETL
 * vendor's destination docs) that all converge on the same endpoint, host,
 * and field names — spec cross-reference dated 2026-09-08. The previous
 * constant (`api.oaiq.openai.com`) does not match any of them, which per
 * the PRD's own note is a finding worth recording: no OpenAI delivery
 * through this file has ever reached OpenAI's real endpoint.
 *
 * Before enabling live delivery, re-verify directly against
 * developers.openai.com/ads/conversions-api (and /supported-events) —
 * the exact `data.*` field names below for `contents`/`customer_action`
 * shapes are inferred from third-party recreations, not the primary
 * spec, and two sources disagreed on whether city/zip are hashed or sent
 * raw (this file hashes them, matching the majority of sources and
 * Atlas's own convention for every other provider).
 *
 * Verified facts (cross-referenced, not primary-sourced):
 *   - Endpoint: POST https://bzr.openai.com/v1/events?pid=<PIXEL_ID>
 *   - Auth: `Authorization: Bearer <API_KEY>` (the Conversions API key,
 *     provisioned alongside the Pixel ID from Ads Manager's conversions tab)
 *   - Body: { validate_only: boolean, events: Event[] } — up to 1000
 *     events per batch; the API reports the whole batch as failed if any
 *     one event in it is invalid
 *   - Event: { id, type, timestamp_ms, oppref?, source_url?, data, user? }
 *     - `type` is a standard event name (order_created, lead_created, ...)
 *       or a custom_event_name (lowercase/digits/underscore/dash, 1-64 chars)
 *     - `data.type` must match the event's expected shape — 'contents'
 *       (order_created/checkout_started), 'customer_action' (lead_created),
 *       'plan_enrollment' (subscription_created), or 'custom'
 *     - `oppref` is a *pixel-only* auto-capture — the Conversions API does
 *       NOT read it automatically the way it reads `user`; the caller must
 *       supply it explicitly, which is exactly what A-W2 wires up below
 *   - `user` (optional, improves match quality): email_address,
 *     phone_number, external_id, country, city, zip_code — each SHA-256
 *     hex digest of the normalised value (never raw)
 *   - Pixel loader: https://bzrcdn.openai.com/sdk/oaiq.min.js, global
 *     `oaiq()` queue function, stores the captured `oppref` URL param in a
 *     first-party `__oppref` cookie with a 720-hour (30-day) TTL
 *   - Attribution window: 7-day click / 1-day view by default
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

const OAIQ_EVENTS_BASE = 'https://bzr.openai.com/v1/events';

function oaiqEventsUrl(pixelId: string): string {
  return `${OAIQ_EVENTS_BASE}?pid=${encodeURIComponent(pixelId)}`;
}

function oaiqHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

/** Which `data` shape a standard event name requires (Supported Events spec) — 'custom' for anything not in this map. */
const EVENT_DATA_SHAPE: Record<string, 'contents' | 'customer_action' | 'plan_enrollment'> = {
  order_created: 'contents',
  checkout_started: 'contents',
  contents_viewed: 'contents',
  items_added: 'contents',
  lead_created: 'customer_action',
  subscription_created: 'plan_enrollment',
  trial_started: 'plan_enrollment',
};

export interface OAIQEventData {
  type: 'contents' | 'customer_action' | 'plan_enrollment' | 'custom';
  value?: number;
  currency?: string;
}

export interface OAIQUser {
  email_address?: string;
  phone_number?: string;
  external_id?: string;
  country?: string;
  city?: string;
  zip_code?: string;
}

export interface OAIQConversionEvent {
  id: string;
  type: string;
  timestamp_ms: number;
  /** First-class click identifier (A-W2) — the caller supplies this explicitly; the Conversions API never auto-captures it the way the pixel does. */
  oppref?: string;
  source_url?: string;
  data: OAIQEventData;
  user?: OAIQUser;
}

/**
 * Build a single OAIQ conversion event from an AtlasEvent + hashed identifiers.
 * `oppref` now reads from its own first-class identifier (A-W2) rather than
 * being smuggled through `user_data.external_id`, which is left free for
 * genuine external IDs.
 */
export function formatOpenAIEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  _creds: OpenAICredentials,
): OAIQConversionEvent {
  const user: OAIQUser = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       user.email_address = id.value; break;
      case 'phone':       user.phone_number   = id.value; break;
      case 'external_id': user.external_id    = id.value; break;
      case 'country':     user.country        = id.value; break;
      case 'ct':          user.city           = id.value; break;
      case 'zp':          user.zip_code       = id.value; break;
    }
  }

  const eventType = mapping.provider_event ?? event.event_name;
  const shape = EVENT_DATA_SHAPE[eventType] ?? 'custom';

  const data: OAIQEventData = { type: shape };
  if (event.custom_data?.value !== undefined) {
    data.value = event.custom_data.value;
    data.currency = event.custom_data.currency?.toUpperCase();
  }

  const oppref = identifiers.find((id) => id.type === 'oppref')?.value;

  const payload: OAIQConversionEvent = {
    id: event.event_id,
    type: eventType,
    timestamp_ms: event.event_time * 1000,
    data,
  };
  if (oppref) payload.oppref = oppref;
  if (event.event_source_url) payload.source_url = event.event_source_url;
  if (Object.keys(user).length > 0) payload.user = user;

  return payload;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

interface OAIQBatchResponse {
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
  let body: OAIQBatchResponse;

  try {
    res = await fetch(oaiqEventsUrl(creds.publisher_id), {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({ validate_only: false, events: conversionEvents }),
    });
    body = await res.json() as OAIQBatchResponse;
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
    // The API fails the whole batch on a single bad event — no per-event
    // status to disaggregate, so every event in this call is reported failed.
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
    const res = await fetch(oaiqEventsUrl(creds.publisher_id), {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({ validate_only: true, events: [formatted] }),
    });

    const body = await res.json() as OAIQBatchResponse;

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
    const res = await fetch(oaiqEventsUrl(creds.publisher_id), {
      method: 'POST',
      headers: oaiqHeaders(creds.api_key),
      body: JSON.stringify({
        validate_only: true,
        events: [{
          id: `atlas-validate-${randomUUID()}`,
          type: 'page_viewed',
          timestamp_ms: Date.now(),
          data: { type: 'custom' },
        }],
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
