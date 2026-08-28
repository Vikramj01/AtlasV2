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

import { randomUUID, createHash } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  LinkedInCredentials,
  LinkedInConversionRuleType,
  LinkedInConversionOwnershipType,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getLinkedInDedupEntry } from './dedupStore';
import logger from '@/utils/logger';

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const LINKEDIN_API_BASE = 'https://api.linkedin.com';
// LinkedIn sunsets Marketing API versions roughly annually — 202507 is already
// sunset as of Aug 2026. Bump this on a recurring basis (see M1/M3 in
// ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md); do not let it go stale silently,
// since the failure mode is underreporting, not an obvious outage.
const LINKEDIN_VERSION  = '202608';

// ── Local payload types ───────────────────────────────────────────────────────

type LinkedInUserId =
  | { idType: 'SHA256_EMAIL'; idValue: string }
  | { idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID'; idValue: string }
  | { idType: 'ACXIOM_ID'; idValue: string }
  | { idType: 'ORACLE_MOAT_ID'; idValue: string }
  // Added by LinkedIn in 2026 (B8, ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md):
  // PLAINTEXT_IP_ADDRESS (May), SHA256_IP_ADDRESS (Jul). Atlas sends the hashed
  // variant by default, consistent with the SHA-256 PII hashing used across
  // every other CAPI provider — see formatLinkedInEvent().
  | { idType: 'SHA256_IP_ADDRESS'; idValue: string }
  | { idType: 'PLAINTEXT_IP_ADDRESS'; idValue: string }
  | { idType: 'GOOGLE_AID'; idValue: string };

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

// ── Conversion routing ────────────────────────────────────────────────────────

/**
 * Resolve which LinkedIn conversion_id an event should post against.
 *
 * LinkedIn's "conversion type" (STANDARD vs. the 2026 qualified-lead rule
 * types) is a property of the Conversion resource itself, configured in
 * Campaign Manager — not a per-event field. So routing a qualified-lead
 * event to the right conversion means picking a different conversion_id,
 * not setting a type on the payload. conversion_routes (B8) maps specific
 * Atlas event names to a non-default conversion; anything unmatched falls
 * back to creds.conversion_id, so existing single-conversion configs are
 * unaffected.
 */
function resolveConversionId(
  creds: Pick<LinkedInCredentials, 'conversion_id' | 'conversion_routes'>,
  eventName: string,
): string {
  const route = creds.conversion_routes?.find((r) => r.event_names.includes(eventName));
  return route?.conversion_id ?? creds.conversion_id;
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
 *   - client_ip_address (event.user_data), if present, is sent as SHA256_IP_ADDRESS —
 *     hashed rather than PLAINTEXT_IP_ADDRESS, consistent with the SHA-256 PII
 *     hashing standard used across every other CAPI provider in this pipeline.
 *   - conversion_id is resolved per-event via creds.conversion_routes (B8) so a
 *     qualified-lead event can target a different LinkedIn conversion than the
 *     account's default.
 */
export function formatLinkedInEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  creds: Pick<LinkedInCredentials, 'conversion_id' | 'conversion_routes'>,
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

  const rawIp = event.user_data.client_ip_address?.trim();
  if (rawIp) {
    userIds.push({ idType: 'SHA256_IP_ADDRESS', idValue: sha256hex(rawIp) });
  }

  // countryCode is NOT hashed — use raw event value, normalised to 2-char uppercase ISO code
  const rawCountry = event.user_data.country?.trim().slice(0, 2).toUpperCase();
  if (rawCountry) {
    userInfo.countryCode = rawCountry;
  }

  const conversionEvent: LinkedInConversionEvent = {
    conversion: buildConversionUrn(resolveConversionId(creds, event.event_name)),
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
      creds,
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
    creds,
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

// ── Conversion discovery (multi-account, B8) ────────────────────────────────

export interface LinkedInConversionSummary {
  conversion_id: string;
  name: string;
  rule_type: LinkedInConversionRuleType;
  ownership_type: LinkedInConversionOwnershipType;
  account: string; // sponsored-account URN this conversion belongs to
}

interface LinkedInConversionsListResponse {
  elements?: Array<{
    id: number | string;
    name?: string;
    type?: string;
    conversionOwnershipTypes?: string[];
    account?: string;
  }>;
}

/**
 * Discover LinkedIn Conversions available to an ad account — including ones
 * shared to it rather than owned by it (conversionOwnershipTypes), the
 * multi-account discovery piece of B8. Powers a conversion picker in the
 * frontend so a user can select an existing qualified-lead conversion
 * (MAX_QUALIFIED_LEAD / MARKETING_QUALIFIED_LEAD / SALES_QUALIFIED_LEAD)
 * instead of hand-typing a conversion_id.
 *
 * NOTE: LinkedIn's Conversions Management API response shape for the 2026
 * conversion-sharing fields postdates this code's reference documentation —
 * field names here (`type`, `conversionOwnershipTypes`, `account`) are our
 * best-effort mapping and should be verified against LinkedIn's current API
 * reference before this ships. Unknown `type` values fall back to 'STANDARD'
 * and unknown ownership values are passed through as 'OWNER' rather than
 * throwing, so a schema drift degrades gracefully instead of breaking
 * discovery entirely.
 */
export async function listLinkedInConversions(
  creds: Pick<LinkedInCredentials, 'access_token' | 'account_id'>,
): Promise<LinkedInConversionSummary[]> {
  const accountUrn = `urn:li:sponsoredAccount:${creds.account_id}`;
  const url = `${LINKEDIN_API_BASE}/rest/conversions?q=account&account=${encodeURIComponent(accountUrn)}`;

  const res = await fetch(url, { headers: linkedInHeaders(creds.access_token) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `LinkedIn conversion discovery failed (HTTP ${res.status})`);
  }

  const body = await res.json() as LinkedInConversionsListResponse;
  const knownRuleTypes: LinkedInConversionRuleType[] =
    ['STANDARD', 'MAX_QUALIFIED_LEAD', 'MARKETING_QUALIFIED_LEAD', 'SALES_QUALIFIED_LEAD'];

  return (body.elements ?? []).map((el) => ({
    conversion_id: String(el.id),
    name: el.name ?? `Conversion ${el.id}`,
    rule_type: knownRuleTypes.includes(el.type as LinkedInConversionRuleType)
      ? el.type as LinkedInConversionRuleType
      : 'STANDARD',
    ownership_type: (el.conversionOwnershipTypes?.includes('CONVERSION_SHARING')
      ? 'CONVERSION_SHARING'
      : 'OWNER') as LinkedInConversionOwnershipType,
    account: el.account ?? accountUrn,
  }));
}
