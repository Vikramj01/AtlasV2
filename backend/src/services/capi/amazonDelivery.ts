/**
 * Amazon Ads Conversions API — Delivery Service
 *
 * Sends events to the Amazon Ads Conversions API:
 *   POST https://advertising-api{-region}.amazon.com/dsp/conversionEvents
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → AmazonConversionEvent
 *   - OAuth 2.0 token refresh on 401 (LWA — Login With Amazon)
 *   - Dedup via Redis (24-hour window, keyed by external_id|email_hash + event_name)
 *   - Per-event error parsing from API response
 *   - Credential validation via GET /v2/profiles
 *
 * Amazon matching uses PII-only (no click cookie equivalent like fbc/gclid).
 * All PII fields are SHA-256 hashed before transmission (same normalisations as Meta).
 *
 * Reference:
 *   https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-cloud/playbooks/off-amazon-conversions
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  AmazonCredentials,
  AmazonConversionEvent,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getAmazonDedupEntry } from './dedupStore';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

// ── Regional endpoints ────────────────────────────────────────────────────────

const AMAZON_API_HOSTS: Record<string, string> = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

const AMAZON_TOKEN_ENDPOINT = 'https://api.amazon.com/auth/o2/token';

function apiHost(region?: string): string {
  return AMAZON_API_HOSTS[region ?? 'NA'] ?? AMAZON_API_HOSTS['NA'];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function amazonHeaders(accessToken: string, profileId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-Api-Scope': profileId,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

/**
 * Build a single Amazon CAPI event from an AtlasEvent + hashed identifiers.
 *
 * Amazon expects SHA-256 hashed PII. Click IDs are not used — matching is
 * purely PII-based or via MAID (Mobile Ad ID, passed raw).
 */
export function formatAmazonEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  dedupeId: string,
): AmazonConversionEvent {
  const matchKeys: AmazonConversionEvent['matchKeys'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       matchKeys.hashedEmail     = id.value; break;
      case 'phone':       matchKeys.hashedPhone     = id.value; break;
      case 'fn':          matchKeys.hashedFirstName = id.value; break;
      case 'ln':          matchKeys.hashedLastName  = id.value; break;
      case 'ct':          matchKeys.hashedCity      = id.value; break;
      case 'st':          matchKeys.hashedState     = id.value; break;
      case 'zp':          matchKeys.hashedPostal    = id.value; break;
      // external_id passed raw per Amazon spec
      case 'external_id': matchKeys.externalId = id.value; break;
    }
  }

  const actionSource = event.action_source === 'app' ? 'mobile_app'
    : event.action_source === 'physical_store' ? 'offline'
    : 'website';

  const conversionEvent: AmazonConversionEvent = {
    name: event.event_name,
    eventType: mapping.provider_event ?? event.event_name,
    eventSource: actionSource,
    countryCode: (event.user_data.country ?? 'US').toUpperCase().slice(0, 2),
    timestamp: new Date(event.event_time * 1000).toISOString(),
    clientDedupeId: dedupeId,
    matchKeys,
  };

  if (event.custom_data?.value !== undefined && event.custom_data.currency) {
    conversionEvent.value = {
      currencyCode: event.custom_data.currency.toUpperCase(),
      amount: event.custom_data.value,
    };
  }

  void mapping;
  return conversionEvent;
}

// ── OAuth token refresh ───────────────────────────────────────────────────────

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function refreshAmazonToken(creds: AmazonCredentials): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  });

  const res = await fetch(AMAZON_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Amazon token refresh failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json() as TokenRefreshResponse;
  return data.access_token;
}

async function updateAmazonToken(
  providerId: string,
  newToken: string,
  expiresIn: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  // Update the access_token inside the encrypted credentials blob via the DB function
  // We patch just the expiry timestamp column; full credential re-encryption on refresh
  // would require reading + decrypting + re-encrypting — instead store expiry separately
  await supabaseAdmin
    .from('capi_providers')
    .update({
      access_token_expires_at: expiresAt,
      // credentials update must happen at the application layer via credentials.ts
      // The caller (pipeline) will receive the new token in this request's in-memory creds
    })
    .eq('id', providerId);

  logger.info({ providerId }, 'Amazon OAuth token refreshed; expiry updated in DB');
  void newToken; // returned to caller for use in this request
}

// ── Delivery ──────────────────────────────────────────────────────────────────

interface AmazonConversionResponse {
  eventId?: string;
  status?: string;
  errors?: Array<{ code: string; message: string; eventIndex?: number }>;
}

/**
 * Send a batch of events to the Amazon Ads Conversions API.
 * Returns one DeliveryResult per event.
 */
export async function sendAmazonEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: AmazonCredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  // Resolve dedup IDs per event
  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const fallbackId = e.event_id || randomUUID();
      if (!providerId) return { entry: null, dedupeId: fallbackId };

      // Use external_id or hashed email as the stable identifier for Amazon dedup
      // (no click cookie equivalent available)
      const stableKey = e.user_data.external_id ?? e.user_data.email ?? fallbackId;
      const entry = await getAmazonDedupEntry(providerId, stableKey, e.event_name);
      return { entry, dedupeId: entry?.event_id ?? fallbackId };
    }),
  );

  const mappingFor = (eventName: string): EventMapping =>
    mappings.find((m) => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: eventName };

  const conversionEvents: AmazonConversionEvent[] = events.map((e, i) =>
    formatAmazonEvent(
      e,
      mappingFor(e.event_name),
      identifiersPerEvent[i] ?? [],
      dedupResults[i].dedupeId,
    ),
  );

  let accessToken = creds.access_token;
  const host = apiHost(creds.region);
  const endpoint = `${host}/dsp/conversionEvents`;

  async function attemptSend(token: string): Promise<{ res: Response; body: AmazonConversionResponse }> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: amazonHeaders(token, creds.profile_id),
      body: JSON.stringify({ conversionEvents }),
    });
    const body = await res.json() as AmazonConversionResponse;
    return { res, body };
  }

  let res: Response;
  let body: AmazonConversionResponse;

  try {
    const attempt = await attemptSend(accessToken);
    res = attempt.res;
    body = attempt.body;

    // Refresh token on 401 and retry once
    if (res.status === 401 && creds.refresh_token) {
      logger.info({ providerId }, 'Amazon CAPI: access token expired, refreshing');
      try {
        accessToken = await refreshAmazonToken(creds);
        if (providerId) await updateAmazonToken(providerId, accessToken, 3600);
        const retry = await attemptSend(accessToken);
        res = retry.res;
        body = retry.body;
      } catch (refreshErr) {
        const errMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        logger.error({ providerId, err: errMsg }, 'Amazon CAPI: token refresh failed');
        return events.map((_, i) => ({
          event_id: dedupResults[i].dedupeId,
          status: 'failed' as const,
          provider_response: null,
          error_code: 'TOKEN_REFRESH_FAILED',
          error_message: errMsg,
        }));
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    logger.error({ provider: 'amazon', err: errMsg }, 'Amazon CAPI network error');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: null,
      error_code: 'NETWORK_ERROR',
      error_message: errMsg,
    }));
  }

  if (!res.ok) {
    const errors = body.errors ?? [];
    const firstErr = errors[0];
    const errCode = firstErr?.code ?? `HTTP_${res.status}`;
    const errMsg  = firstErr?.message ?? `Amazon Ads API HTTP ${res.status}`;
    logger.warn({ provider: 'amazon', status: res.status, code: errCode }, 'Amazon CAPI request failed');
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

  // Per-event error map (Amazon can return per-event errors with eventIndex)
  const errorsByIndex = new Map<number, { code: string; message: string }>();
  for (const err of body.errors ?? []) {
    if (err.eventIndex !== undefined) {
      errorsByIndex.set(err.eventIndex, { code: err.code, message: err.message });
    }
  }

  return events.map((e, i) => {
    const { entry, dedupeId } = dedupResults[i];
    const eventErr = errorsByIndex.get(i);

    if (eventErr) {
      return {
        event_id: dedupeId,
        status: 'failed' as const,
        provider_response: body,
        error_code: eventErr.code,
        error_message: eventErr.message,
        dedup_status: providerId
          ? (entry ? 'hit' : 'miss') as 'hit' | 'miss'
          : undefined,
      };
    }

    return {
      event_id: dedupeId,
      status: 'delivered' as const,
      provider_response: body,
      dedup_status: providerId
        ? (entry ? 'hit' : 'miss') as 'hit' | 'miss'
        : undefined,
      dedup_key: providerId && e.event_id
        ? `${providerId}:${e.user_data.external_id ?? e.user_data.email ?? e.event_id}:${e.event_name}`
        : undefined,
      dedup_matched_at: entry ? new Date().toISOString() : undefined,
    };
  });
}

// ── Test event ────────────────────────────────────────────────────────────────

/**
 * Send a single test event to Amazon CAPI.
 * Amazon has no sandbox endpoint — prefixes clientDedupeId with "atlas-test-"
 * so events can be identified and filtered in Amazon Marketing Cloud.
 */
export async function sendAmazonTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: AmazonCredentials,
): Promise<TestResult> {
  const testDedupeId = `atlas-test-${randomUUID()}`;
  const formatted = formatAmazonEvent(event, mapping, identifiers, testDedupeId);
  const host = apiHost(creds.region);

  try {
    const res = await fetch(`${host}/dsp/conversionEvents`, {
      method: 'POST',
      headers: amazonHeaders(creds.access_token, creds.profile_id),
      body: JSON.stringify({ conversionEvents: [formatted] }),
    });

    const body = await res.json() as AmazonConversionResponse;

    if (!res.ok) {
      const firstErr = body.errors?.[0];
      return {
        status: 'failed',
        provider_response: body,
        error: firstErr?.message ?? `Amazon Ads API HTTP ${res.status}`,
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
 * Validate Amazon credentials by fetching advertising profiles.
 * A valid token with the correct scope returns at least one profile.
 */
export async function validateAmazonCredentials(
  creds: AmazonCredentials,
): Promise<ValidationResult> {
  const required = ['profile_id', 'client_id', 'client_secret', 'access_token', 'refresh_token'] as const;
  const missing = required.filter((k) => !creds[k]);
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  const host = apiHost(creds.region);

  try {
    const res = await fetch(`${host}/v2/profiles`, {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Amazon-Advertising-Api-Scope': creds.profile_id,
      },
    });

    if (res.ok) return { valid: true };

    const body = await res.json().catch(() => ({})) as { message?: string };
    return {
      valid: false,
      error: body.message ?? `Invalid or expired access token (HTTP ${res.status})`,
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
