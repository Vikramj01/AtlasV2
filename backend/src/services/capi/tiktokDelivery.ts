/**
 * TikTok Events API — Delivery Service
 *
 * Sends events to the TikTok Events API v1.3:
 *   POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → TikTok event track payload
 *   - Dedup via Redis (7-day window, keyed by event_id — TikTok dedups on event_id)
 *   - Per-request error parsing (TikTok returns a single `code`/`message`, not per-event)
 *   - Credential validation via a live test-event call (no dedicated validation endpoint
 *     exists for a pixel_id + access_token pair without also holding an advertiser_id)
 *
 * TikTok matching uses SHA-256 hashed PII (each field as a one-item array) plus ttclid,
 * the TikTok click identifier — captured raw (unhashed, per TikTok's spec) alongside
 * gclid/fbclid/wbraid/gbraid via the GTM click-ID capture tag, the Shopify storefront
 * capture script, and `client_identity_configs.ttclid_field`.
 *
 * Reference:
 *   https://business-api.tiktok.com/portal/docs?id=1771101186666498
 */

import { randomUUID, createHash } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  TikTokCredentials,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getTikTokDedupEntry } from './dedupStore';
import logger from '@/utils/logger';

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function tiktokHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Token': accessToken,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

export interface TikTokTrackEvent {
  event: string;
  event_time: number;
  event_id: string;
  user: {
    email?: string[];
    phone?: string[];
    external_id?: string[];
    ttclid?: string;
    ip?: string;
    user_agent?: string;
  };
  properties?: {
    currency?: string;
    value?: string;
    content_type?: string;
    content_ids?: string[];
    order_id?: string;
  };
  page?: { url?: string };
}

/**
 * Build a single TikTok Events API track event from an AtlasEvent + hashed identifiers.
 * TikTok expects each hashed PII field as a single-element array.
 */
export function formatTikTokEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
): TikTokTrackEvent {
  const user: TikTokTrackEvent['user'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       user.email       = [id.value]; break;
      case 'phone':       user.phone       = [id.value]; break;
      case 'external_id': user.external_id = [id.value]; break;
      case 'ttclid':      user.ttclid      = id.value;   break;
    }
  }
  if (event.user_data.client_ip_address) user.ip = event.user_data.client_ip_address;
  if (event.user_data.client_user_agent) user.user_agent = event.user_data.client_user_agent;

  const trackEvent: TikTokTrackEvent = {
    event: mapping.provider_event ?? event.event_name,
    event_time: event.event_time,
    event_id: event.event_id,
    user,
  };

  if (event.custom_data) {
    trackEvent.properties = {
      ...(event.custom_data.currency && { currency: event.custom_data.currency.toUpperCase() }),
      ...(event.custom_data.value !== undefined && { value: String(event.custom_data.value) }),
      ...(event.custom_data.content_type && { content_type: event.custom_data.content_type }),
      ...(event.custom_data.content_ids && { content_ids: event.custom_data.content_ids }),
      ...(event.custom_data.order_id && { order_id: event.custom_data.order_id }),
    };
  }

  if (event.event_source_url) {
    trackEvent.page = { url: event.event_source_url };
  }

  return trackEvent;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

interface TikTokTrackResponse {
  code: number;
  message: string;
  request_id?: string;
  data?: Record<string, unknown>;
}

/**
 * Send a batch of events to the TikTok Events API.
 * TikTok's `event/track/` endpoint accepts multiple events per call but returns
 * one request-level result — a rejected batch fails every event in it, mirroring
 * how the pipeline calls this (one event per call today).
 */
export async function sendTikTokEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: TikTokCredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const fallbackId = e.event_id || randomUUID();
      if (!providerId) return { entry: null, dedupeId: fallbackId };
      const entry = await getTikTokDedupEntry(providerId, fallbackId, e.event_name);
      return { entry, dedupeId: fallbackId };
    }),
  );

  const mappingFor = (eventName: string): EventMapping =>
    mappings.find((m) => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: eventName };

  const trackEvents: TikTokTrackEvent[] = events.map((e, i) =>
    formatTikTokEvent(e, mappingFor(e.event_name), identifiersPerEvent[i] ?? []),
  );

  const endpoint = `${TIKTOK_API_BASE}/event/track/`;
  let res: Response;
  let body: TikTokTrackResponse;

  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: tiktokHeaders(creds.access_token),
      body: JSON.stringify({
        event_source: 'web',
        event_source_id: creds.pixel_id,
        data: trackEvents,
      }),
    });
    body = await res.json() as TikTokTrackResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    logger.error({ provider: 'tiktok', err: errMsg }, 'TikTok Events API network error');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: null,
      error_code: 'NETWORK_ERROR',
      error_message: errMsg,
    }));
  }

  const succeeded = res.ok && body.code === 0;

  if (!succeeded) {
    const errCode = `TIKTOK_${body.code ?? res.status}`;
    const errMsg = body.message ?? `TikTok Events API HTTP ${res.status}`;
    logger.warn({ provider: 'tiktok', status: res.status, code: body.code }, 'TikTok Events API request failed');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: body,
      error_code: errCode,
      error_message: errMsg,
      dedup_status: providerId
        ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss'
        : undefined,
    }));
  }

  return events.map((e, i) => ({
    event_id: dedupResults[i].dedupeId,
    status: 'delivered' as const,
    provider_response: body,
    dedup_status: providerId
      ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss'
      : undefined,
    dedup_key: providerId ? `${providerId}:${dedupResults[i].dedupeId}:${e.event_name}` : undefined,
    dedup_matched_at: dedupResults[i].entry ? new Date().toISOString() : undefined,
  }));
}

// ── Test event ────────────────────────────────────────────────────────────────

/**
 * Send a single test event to TikTok Events API.
 * TikTok routes events flagged with `test_event_code` to the Test Events tab in
 * Events Manager instead of live reporting — no separate sandbox endpoint exists.
 */
export async function sendTikTokTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: TikTokCredentials,
  testEventCode?: string,
): Promise<TestResult> {
  const formatted = formatTikTokEvent(event, mapping, identifiers);

  try {
    const res = await fetch(`${TIKTOK_API_BASE}/event/track/`, {
      method: 'POST',
      headers: tiktokHeaders(creds.access_token),
      body: JSON.stringify({
        event_source: 'web',
        event_source_id: creds.pixel_id,
        data: [formatted],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
    });

    const body = await res.json() as TikTokTrackResponse;

    if (!res.ok || body.code !== 0) {
      return {
        status: 'failed',
        provider_response: body,
        error: body.message ?? `TikTok Events API HTTP ${res.status}`,
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

/**
 * Validate TikTok credentials by sending a minimal test event.
 * TikTok has no standalone "check this token" endpoint that works with just a
 * pixel_id + access_token (its account/pixel lookup endpoints require an
 * advertiser_id, which Atlas does not collect for this provider) — a real
 * test-event call against `event/track/` is the closest equivalent: an invalid
 * or expired token returns a non-zero `code` (commonly 40001/40105) that we
 * surface as the validation error.
 */
export async function validateTikTokCredentials(
  creds: TikTokCredentials,
): Promise<ValidationResult> {
  const required = ['pixel_id', 'access_token'] as const;
  const missing = required.filter((k) => !creds[k]);
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  try {
    const res = await fetch(`${TIKTOK_API_BASE}/event/track/`, {
      method: 'POST',
      headers: tiktokHeaders(creds.access_token),
      body: JSON.stringify({
        event_source: 'web',
        event_source_id: creds.pixel_id,
        data: [{
          event: 'ViewContent',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `atlas-validate-${randomUUID()}`,
          user: {},
        }],
      }),
    });

    const body = await res.json().catch(() => ({})) as TikTokTrackResponse;

    if (res.ok && body.code === 0) return { valid: true };

    return {
      valid: false,
      error: body.message ?? `Invalid TikTok credentials (HTTP ${res.status})`,
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
