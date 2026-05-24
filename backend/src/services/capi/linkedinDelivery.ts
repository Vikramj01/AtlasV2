/**
 * LinkedIn Conversions API — Delivery Service
 *
 * Sends events to the LinkedIn Marketing API (Restli):
 *   POST https://api.linkedin.com/rest/conversionEvents
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → LinkedInConversionEvent
 *   - Batch delivery via Restli batch endpoint
 *   - Per-element error parsing from the batch response
 *   - Dedup via Redis (48-hour window, keyed by event_id — LinkedIn has no click cookie)
 *   - Credential validation via GET /v2/userinfo
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  LinkedInCredentials,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getLinkedInDedupEntry } from './dedupStore';
import logger from '@/utils/logger';

const LINKEDIN_API_BASE = 'https://api.linkedin.com';
const LINKEDIN_VERSION  = '202501';

// ── Local payload types ───────────────────────────────────────────────────────

type LinkedInUserId =
  | { idType: 'SHA256_EMAIL'; idValue: string }
  | { idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID'; idValue: string }
  | { idType: 'ACXIOM_ID'; idValue: string }
  | { idType: 'ORACLE_MOAT_ID'; idValue: string };

interface LinkedInConversionEvent {
  conversion: string;           // URN: "urn:lla:llaPartnerConversion:{id}"
  conversionHappenedAt: number; // Unix ms
  conversionValue?: { currencyCode: string; amount: string };
  eventId?: string;
  user: {
    userIds: LinkedInUserId[];
    userInfo?: {
      firstName?: string;   // SHA-256 hashed
      lastName?: string;    // SHA-256 hashed
      title?: string;
      companyName?: string;
      countryCode?: string; // Raw 2-letter ISO code — NOT hashed
    };
  };
}

interface LinkedInBatchResponse {
  elements?: Array<{
    status: number;
    element?: unknown;
    error?: { code: string; message: string };
  }>;
  status?: number;
  serviceErrorCode?: number;
  code?: string;
  message?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildConversionUrn(conversionId: string): string {
  return `urn:lla:llaPartnerConversion:${conversionId}`;
}

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_VERSION,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

/**
 * Format a single AtlasEvent + hashed identifiers into a LinkedIn conversionEvent payload.
 *
 * Notes:
 *   - SHA256_EMAIL uses the hashed email identifier from the pipeline.
 *   - userInfo.firstName / lastName use hashed fn/ln identifiers.
 *   - userInfo.countryCode is the raw ISO-3166-1 alpha-2 code (NOT hashed) taken
 *     from event.user_data.country, since LinkedIn expects a plaintext country code.
 */
export function formatLinkedInEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  conversionId: string,
  eventId: string,
): LinkedInConversionEvent {
  const userIds: LinkedInUserId[] = [];
  const userInfo: NonNullable<LinkedInConversionEvent['user']['userInfo']> = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':
        userIds.push({ idType: 'SHA256_EMAIL', idValue: id.value });
        break;
      case 'fn':
        userInfo.firstName = id.value;
        break;
      case 'ln':
        userInfo.lastName = id.value;
        break;
    }
  }

  // countryCode is NOT hashed — use raw event value, normalised to 2-char uppercase ISO code
  const rawCountry = event.user_data.country?.trim().slice(0, 2).toUpperCase();
  if (rawCountry) {
    userInfo.countryCode = rawCountry;
  }

  const conversionEvent: LinkedInConversionEvent = {
    conversion: buildConversionUrn(conversionId),
    conversionHappenedAt: event.event_time * 1000, // seconds → ms
    eventId,
    user: {
      userIds,
      ...(Object.keys(userInfo).length > 0 && { userInfo }),
    },
  };

  if (event.custom_data?.value !== undefined && event.custom_data.currency) {
    conversionEvent.conversionValue = {
      currencyCode: event.custom_data.currency.toUpperCase(),
      amount: String(event.custom_data.value),
    };
  }

  void mapping; // event type lives in the conversion URN, not the payload
  return conversionEvent;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Send a batch of events to the LinkedIn Conversions API.
 * Returns one DeliveryResult per event.
 *
 * Dedup: keyed by (providerId, event_id, eventName) — LinkedIn has no click cookie
 * equivalent, so event_id is the best available stable identifier.
 */
export async function sendLinkedInEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: LinkedInCredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const eventId = e.event_id || randomUUID();
      if (!providerId) return { entry: null, eventId };
      const entry = await getLinkedInDedupEntry(providerId, eventId, e.event_name);
      return { entry, eventId: entry?.event_id ?? eventId };
    }),
  );

  const mappingFor = (eventName: string): EventMapping =>
    mappings.find(m => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: eventName };

  const elements: LinkedInConversionEvent[] = events.map((e, i) =>
    formatLinkedInEvent(
      e,
      mappingFor(e.event_name),
      identifiersPerEvent[i] ?? [],
      creds.conversion_id,
      dedupResults[i].eventId,
    ),
  );

  let res: Response;
  let body: LinkedInBatchResponse;

  try {
    res = await fetch(`${LINKEDIN_API_BASE}/rest/conversionEvents`, {
      method: 'POST',
      headers: linkedInHeaders(creds.access_token),
      body: JSON.stringify({ elements }),
    });
    body = await res.json() as LinkedInBatchResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    logger.error({ provider: 'linkedin', err: errMsg }, 'LinkedIn CAPI network error');
    return events.map((_, i) => ({
      event_id: dedupResults[i].eventId,
      status: 'failed' as const,
      provider_response: null,
      error_code: 'NETWORK_ERROR',
      error_message: errMsg,
    }));
  }

  // Request-level error — LinkedIn returns 4xx with a top-level code/message
  if (!res.ok) {
    const errCode = body.code ?? String(body.status ?? 'DELIVERY_FAILED');
    const errMsg  = body.message ?? `LinkedIn API HTTP ${res.status}`;
    logger.warn({ provider: 'linkedin', status: res.status, code: errCode }, 'LinkedIn CAPI request failed');
    return events.map((_, i) => ({
      event_id: dedupResults[i].eventId,
      status: 'failed' as const,
      provider_response: body,
      error_code: errCode,
      error_message: errMsg,
      dedup_status: providerId
        ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss'
        : undefined,
    }));
  }

  // Per-element results — check each element's status field
  const elementResults = body.elements ?? [];

  return events.map((e, i) => {
    const { entry, eventId } = dedupResults[i];
    const elResult = elementResults[i];
    const isElementError = elResult !== undefined && elResult.status >= 400;

    if (isElementError) {
      return {
        event_id: eventId,
        status: 'failed' as const,
        provider_response: body,
        error_code: elResult.error?.code ?? 'ELEMENT_ERROR',
        error_message: elResult.error?.message ?? `LinkedIn element error (HTTP ${elResult.status})`,
        dedup_status: providerId
          ? (entry ? 'hit' : 'miss') as 'hit' | 'miss'
          : undefined,
      };
    }

    return {
      event_id: eventId,
      status: 'delivered' as const,
      provider_response: body,
      dedup_status: providerId
        ? (entry ? 'hit' : 'miss') as 'hit' | 'miss'
        : undefined,
      dedup_key: providerId && entry && e.event_id
        ? `${providerId}:${e.event_id}:${e.event_name}`
        : undefined,
      dedup_matched_at: entry ? new Date().toISOString() : undefined,
    };
  });
}

// ── Test event ────────────────────────────────────────────────────────────────

/**
 * Send a single test event to LinkedIn CAPI.
 * LinkedIn does not have a dedicated sandbox/test mode, so this fires a real event
 * prefixed with "atlas-test-" in the eventId to aid identification in Campaign Manager.
 */
export async function sendLinkedInTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: LinkedInCredentials,
): Promise<TestResult> {
  const testEventId = `atlas-test-${randomUUID()}`;
  const formatted = formatLinkedInEvent(
    event,
    mapping,
    identifiers,
    creds.conversion_id,
    testEventId,
  );

  try {
    const res = await fetch(`${LINKEDIN_API_BASE}/rest/conversionEvents`, {
      method: 'POST',
      headers: linkedInHeaders(creds.access_token),
      body: JSON.stringify({ elements: [formatted] }),
    });

    const body = await res.json() as LinkedInBatchResponse;

    if (!res.ok) {
      return {
        status: 'failed',
        provider_response: body,
        error: body.message ?? `LinkedIn API HTTP ${res.status}`,
      };
    }

    const elResult = body.elements?.[0];
    if (elResult && elResult.status >= 400) {
      return {
        status: 'failed',
        provider_response: body,
        error: elResult.error?.message ?? `LinkedIn element error (HTTP ${elResult.status})`,
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
 * Validate LinkedIn credentials by calling the OIDC userinfo endpoint.
 * Falls back to /v2/me if userinfo is not permitted by the token's scopes.
 */
export async function validateLinkedInCredentials(
  creds: LinkedInCredentials,
): Promise<ValidationResult> {
  if (!creds.account_id || !creds.access_token || !creds.conversion_id) {
    return {
      valid: false,
      error: 'account_id, access_token, and conversion_id are required',
    };
  }

  const authHeader = { Authorization: `Bearer ${creds.access_token}` };

  try {
    // Primary: OIDC userinfo endpoint (works with openid scope)
    const res = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, { headers: authHeader });

    if (res.ok) return { valid: true };

    // Fallback: basic profile endpoint (works with r_liteprofile scope)
    const fallback = await fetch(`${LINKEDIN_API_BASE}/v2/me`, { headers: authHeader });

    if (fallback.ok) return { valid: true };

    const body = await res.json() as { message?: string; serviceErrorCode?: number };
    return {
      valid: false,
      error: body.message ?? `Invalid or expired access token (HTTP ${res.status})`,
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
