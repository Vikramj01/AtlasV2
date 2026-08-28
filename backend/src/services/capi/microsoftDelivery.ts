/**
 * Microsoft Advertising Conversions API — Delivery Service
 *
 * Microsoft published Conversions API documentation in beta on 17 Aug 2026 —
 * after this codebase's knowledge cutoff, so the exact beta REST endpoint
 * path below is a best-effort placeholder built from Microsoft Advertising's
 * established API conventions (Bearer OAuth + DeveloperToken + CustomerId +
 * CustomerAccountId headers, msclkid as the UET click-match key, hashed PII
 * for enhanced/offline conversion import). Confirm the endpoint against
 * Microsoft's published beta docs before enabling live delivery.
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → Microsoft conversion goal event
 *   - OAuth 2.0 token refresh on 401
 *   - Dedup via Redis (90-day window, keyed by msclkid-equivalent or hashed
 *     email — Atlas has no dedicated msclkid identifier field today, so
 *     click-ID matching falls back to PII until one is added)
 *   - Credential validation via a live customer lookup call
 *
 * Reference (confirm before go-live):
 *   https://learn.microsoft.com/en-us/advertising/conversions-api/
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  MicrosoftCredentials,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import { getMicrosoftDedupEntry } from './dedupStore';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

const MICROSOFT_API_BASE = 'https://api.ads.microsoft.com/v1';
const MICROSOFT_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

function microsoftHeaders(creds: MicrosoftCredentials, accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'DeveloperToken': creds.developer_token,
    'CustomerId': creds.customer_id,
    'CustomerAccountId': creds.account_id,
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

export interface MicrosoftConversionEvent {
  conversionGoalId: string;
  conversionTime: string;      // ISO 8601
  conversionValue?: number;
  conversionCurrencyCode?: string;
  clientDedupeId: string;
  hashedEmailAddress?: string;
  hashedPhoneNumber?: string;
  externalAttributionId?: string;
}

/**
 * Build a single Microsoft Advertising conversion event from an AtlasEvent +
 * hashed identifiers. Microsoft matches on hashed email/phone (like Google
 * Enhanced Conversions) — no click-ID field is populated since Atlas does
 * not yet capture msclkid.
 */
export function formatMicrosoftEvent(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  dedupeId: string,
  creds: MicrosoftCredentials,
): MicrosoftConversionEvent {
  const conversionEvent: MicrosoftConversionEvent = {
    conversionGoalId: mapping.provider_event || creds.conversion_goal_id,
    conversionTime: new Date(event.event_time * 1000).toISOString(),
    clientDedupeId: dedupeId,
  };

  for (const id of identifiers) {
    switch (id.type) {
      case 'email': conversionEvent.hashedEmailAddress = id.value; break;
      case 'phone': conversionEvent.hashedPhoneNumber  = id.value; break;
      case 'external_id': conversionEvent.externalAttributionId = id.value; break;
    }
  }

  if (event.custom_data?.value !== undefined) {
    conversionEvent.conversionValue = event.custom_data.value;
    conversionEvent.conversionCurrencyCode = event.custom_data.currency?.toUpperCase();
  }

  return conversionEvent;
}

// ── OAuth token refresh ───────────────────────────────────────────────────────

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function refreshMicrosoftToken(creds: MicrosoftCredentials): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.oauth_refresh_token,
    scope: 'https://ads.microsoft.com/msads.manage offline_access',
  });

  const res = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Microsoft token refresh failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json() as TokenRefreshResponse;
  return data.access_token;
}

async function updateMicrosoftToken(providerId: string, expiresIn: number): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await supabaseAdmin
    .from('capi_providers')
    .update({ access_token_expires_at: expiresAt })
    .eq('id', providerId);
  logger.info({ providerId }, 'Microsoft OAuth token refreshed; expiry updated in DB');
}

// ── Delivery ──────────────────────────────────────────────────────────────────

interface MicrosoftConversionResponse {
  status?: string;
  errors?: Array<{ code: string; message: string }>;
}

/**
 * Send a batch of events to Microsoft's Conversions API.
 * Returns one DeliveryResult per event.
 */
export async function sendMicrosoftEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: MicrosoftCredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const fallbackId = e.event_id || randomUUID();
      if (!providerId) return { entry: null, dedupeId: fallbackId };
      const stableKey = e.user_data.external_id ?? e.user_data.email ?? fallbackId;
      const entry = await getMicrosoftDedupEntry(providerId, stableKey, e.event_name);
      return { entry, dedupeId: entry?.event_id ?? fallbackId };
    }),
  );

  const mappingFor = (eventName: string): EventMapping =>
    mappings.find((m) => m.atlas_event === eventName) ??
    { atlas_event: eventName, provider_event: creds.conversion_goal_id };

  const conversionEvents: MicrosoftConversionEvent[] = events.map((e, i) =>
    formatMicrosoftEvent(e, mappingFor(e.event_name), identifiersPerEvent[i] ?? [], dedupResults[i].dedupeId, creds),
  );

  let accessToken = creds.oauth_access_token;
  const endpoint = `${MICROSOFT_API_BASE}/conversions:upload`;

  async function attemptSend(token: string): Promise<{ res: Response; body: MicrosoftConversionResponse }> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: microsoftHeaders(creds, token),
      body: JSON.stringify({ conversions: conversionEvents }),
    });
    const body = await res.json() as MicrosoftConversionResponse;
    return { res, body };
  }

  let res: Response;
  let body: MicrosoftConversionResponse;

  try {
    const attempt = await attemptSend(accessToken);
    res = attempt.res;
    body = attempt.body;

    if (res.status === 401 && creds.oauth_refresh_token) {
      logger.info({ providerId }, 'Microsoft CAPI: access token expired, refreshing');
      try {
        accessToken = await refreshMicrosoftToken(creds);
        if (providerId) await updateMicrosoftToken(providerId, 3600);
        const retry = await attemptSend(accessToken);
        res = retry.res;
        body = retry.body;
      } catch (refreshErr) {
        const errMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        logger.error({ providerId, err: errMsg }, 'Microsoft CAPI: token refresh failed');
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
    logger.error({ provider: 'microsoft', err: errMsg }, 'Microsoft CAPI network error');
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
    const errMsg = firstErr?.message ?? `Microsoft Ads API HTTP ${res.status}`;
    logger.warn({ provider: 'microsoft', status: res.status, code: errCode }, 'Microsoft CAPI request failed');
    return events.map((_, i) => ({
      event_id: dedupResults[i].dedupeId,
      status: 'failed' as const,
      provider_response: body,
      error_code: errCode,
      error_message: errMsg,
      dedup_status: providerId ? (dedupResults[i].entry ? 'hit' : 'miss') as 'hit' | 'miss' : undefined,
    }));
  }

  return events.map((e, i) => {
    const { entry, dedupeId } = dedupResults[i];
    return {
      event_id: dedupeId,
      status: 'delivered' as const,
      provider_response: body,
      dedup_status: providerId ? (entry ? 'hit' : 'miss') as 'hit' | 'miss' : undefined,
      dedup_key: providerId
        ? `${providerId}:${e.user_data.external_id ?? e.user_data.email ?? e.event_id}:${e.event_name}`
        : undefined,
      dedup_matched_at: entry ? new Date().toISOString() : undefined,
    };
  });
}

// ── Test event ────────────────────────────────────────────────────────────────

export async function sendMicrosoftTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: MicrosoftCredentials,
): Promise<TestResult> {
  const testDedupeId = `atlas-test-${randomUUID()}`;
  const formatted = formatMicrosoftEvent(event, mapping, identifiers, testDedupeId, creds);

  try {
    const res = await fetch(`${MICROSOFT_API_BASE}/conversions:upload`, {
      method: 'POST',
      headers: microsoftHeaders(creds, creds.oauth_access_token),
      body: JSON.stringify({ conversions: [formatted] }),
    });

    const body = await res.json() as MicrosoftConversionResponse;

    if (!res.ok) {
      const firstErr = body.errors?.[0];
      return {
        status: 'failed',
        provider_response: body,
        error: firstErr?.message ?? `Microsoft Ads API HTTP ${res.status}`,
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
 * Validate Microsoft credentials by fetching customer account info.
 */
export async function validateMicrosoftCredentials(
  creds: MicrosoftCredentials,
): Promise<ValidationResult> {
  const required = ['customer_id', 'account_id', 'developer_token', 'oauth_access_token', 'oauth_refresh_token', 'uet_tag_id', 'conversion_goal_id'] as const;
  const missing = required.filter((k) => !creds[k]);
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  try {
    const res = await fetch(`${MICROSOFT_API_BASE}/customers/${creds.customer_id}/accounts/${creds.account_id}`, {
      headers: microsoftHeaders(creds, creds.oauth_access_token),
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
