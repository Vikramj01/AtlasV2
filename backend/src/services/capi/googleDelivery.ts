/**
 * Google Enhanced Conversions — Delivery Service (DMA)
 *
 * Sends conversion events to the Google Data Manager API:
 *   POST https://datamanager.googleapis.com/v1/events:ingest
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → DMAEvent
 *   - OAuth access token refresh (using stored refresh token + GOOGLE_OAUTH_CLIENT_* env vars)
 *   - Partial failure detection from DMA response envelope
 *   - Credential validation via Google tokeninfo endpoint
 *   - validateOnly mode for test events
 */

import { randomUUID } from 'crypto';
import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  GoogleCredentials,
  GoogleConversionAdjustment,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';
import type {
  DMAEvent,
  DMAEventSource,
  DMAUserIdentifier,
  DMAIngestEventsRequest,
  DMAIngestEventsResponse,
} from '@/integrations/google/dmaTypes';
import logger from '@/utils/logger';
import { getGoogleDedupEntry } from './dedupStore';

const DMA_BASE_URL = 'https://datamanager.googleapis.com/v1';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

function buildConversionActionResource(customerId: string, conversionActionId: string): string {
  return `customers/${cleanCustomerId(customerId)}/conversionActions/${conversionActionId}`;
}

// ── OAuth token refresh ───────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function refreshGoogleToken(creds: GoogleCredentials): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required for token refresh',
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.oauth_refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const body = await res.json() as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(
      body.error_description ?? body.error ?? `Token refresh failed: HTTP ${res.status}`,
    );
  }

  return body.access_token;
}

// ── Consent mapping ───────────────────────────────────────────────────────────

function mapConsentToGoogle(
  consentState: ConsentDecisions,
): GoogleConversionAdjustment['consent'] {
  const map = (v: string | undefined): 'GRANTED' | 'DENIED' | 'UNSPECIFIED' => {
    if (v === 'granted')  return 'GRANTED';
    if (v === 'denied')   return 'DENIED';
    return 'UNSPECIFIED';
  };
  return {
    adUserData:        map(consentState.marketing),
    adPersonalization: map(consentState.personalisation),
  };
}

// ── Payload formatting ────────────────────────────────────────────────────────

export function formatGoogleAdjustment(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  conversionActionResourceName: string,
): GoogleConversionAdjustment {
  const userIdentifiers: GoogleConversionAdjustment['userIdentifiers'] = [];

  const addressInfo: {
    hashedFirstName?: string;
    hashedLastName?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
  } = {};
  let hasAddressField = false;

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':
        userIdentifiers.push({ hashedEmail: id.value });
        break;
      case 'phone':
        userIdentifiers.push({ hashedPhoneNumber: id.value });
        break;
      case 'fn':
        addressInfo.hashedFirstName = id.value;
        hasAddressField = true;
        break;
      case 'ln':
        addressInfo.hashedLastName = id.value;
        hasAddressField = true;
        break;
      case 'ct':
        addressInfo.city = id.value;
        hasAddressField = true;
        break;
      case 'st':
        addressInfo.state = id.value;
        hasAddressField = true;
        break;
      case 'zp':
        addressInfo.postalCode = id.value;
        hasAddressField = true;
        break;
      case 'country':
        addressInfo.countryCode = id.value;
        hasAddressField = true;
        break;
    }
  }

  if (hasAddressField) {
    userIdentifiers.push({ addressInfo });
  }

  const adjustment: GoogleConversionAdjustment = {
    adjustmentType: 'ENHANCEMENT',
    conversionAction: conversionActionResourceName,
    userIdentifiers,
  };

  if (event.user_data.gclid) {
    adjustment.gclidDateTimePair = {
      gclid: event.user_data.gclid,
      conversionDateTime: new Date(event.event_time * 1000).toISOString(),
    };
  }

  if (event.custom_data?.order_id) {
    adjustment.orderId = event.custom_data.order_id;
  }

  if (event.user_data.client_user_agent) {
    adjustment.userAgent = event.user_data.client_user_agent;
  }

  if (event.consent_state) {
    adjustment.consent = mapConsentToGoogle(event.consent_state);
  }

  void mapping;
  return adjustment;
}

// ── GoogleConversionAdjustment → DMAEvent ─────────────────────────────────────

// Maps Atlas/Meta action_source values to the DMA EventSource enum.
// Both online EC and offline conversions use the same DMA endpoint — eventSource
// is the only field that distinguishes them. Store Sales (IN_STORE) requires
// Google account allowlisting; surface a warning in the Deployment Wizard UI.
function actionSourceToDMAEventSource(actionSource: string | undefined): DMAEventSource {
  switch (actionSource) {
    case 'physical_store': return 'IN_STORE';
    case 'phone_call':     return 'PHONE';
    case 'app':            return 'APP';
    case 'system_generated':
    case 'chat':           return 'OTHER';
    default:               return 'WEB';
  }
}

function toDMAEvent(adjustment: GoogleConversionAdjustment, event: AtlasEvent): DMAEvent {
  const eventDateTime = new Date(event.event_time * 1000).toISOString();
  return {
    eventType: 'CONVERSION',
    eventDateTime,
    eventSource: actionSourceToDMAEventSource(event.action_source),
    userIdentifiers: adjustment.userIdentifiers as DMAUserIdentifier[],
    conversionAction: adjustment.conversionAction,
    transactionId: adjustment.orderId,
    gclidDateTimePair: adjustment.gclidDateTimePair
      ? { gclid: adjustment.gclidDateTimePair.gclid, conversionDateTime: eventDateTime }
      : undefined,
    consent: adjustment.consent,
  };
}

// ── DMA HTTP layer ─────────────────────────────────────────────────────────────

function buildDMAHeaders(accessToken: string, loginCustomerId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  const devToken =
    process.env.GOOGLE_DMA_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  if (devToken) headers['developer-token'] = devToken;
  if (loginCustomerId) headers['login-customer-id'] = cleanCustomerId(loginCustomerId);
  return headers;
}

async function sendDMAEventsRequest(
  request: DMAIngestEventsRequest,
  accessToken: string,
  loginCustomerId?: string,
): Promise<{ ok: boolean; status: number; body: DMAIngestEventsResponse }> {
  const res = await fetch(`${DMA_BASE_URL}/events:ingest`, {
    method: 'POST',
    headers: buildDMAHeaders(accessToken, loginCustomerId),
    body: JSON.stringify(request),
  });
  const body = await res.json() as DMAIngestEventsResponse;
  return { ok: res.ok, status: res.status, body };
}

// ── Delivery ──────────────────────────────────────────────────────────────────

export async function sendGoogleEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: GoogleCredentials,
  providerId?: string,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const resource = buildConversionActionResource(creds.customer_id, creds.conversion_action_id);

  const dedupResults = await Promise.all(
    events.map(async (e) => {
      const transactionId = e.custom_data?.order_id ?? null;
      const gclid = e.user_data.gclid ?? null;

      if (transactionId) {
        return { orderId: transactionId, dedup_status: 'hit' as const, dedup_key: undefined };
      }

      const entry = providerId
        ? await getGoogleDedupEntry(providerId, gclid, e.event_name)
        : null;
      const orderId = entry?.event_id ?? randomUUID();
      const dedupStatus: 'hit' | 'miss' = entry ? 'hit' : 'miss';
      const dedupKey =
        providerId && entry && gclid
          ? `${providerId}:${gclid}:${e.event_name}`
          : undefined;

      return { orderId, dedup_status: dedupStatus, dedup_key: dedupKey };
    }),
  );

  const adjustments = events.map((e, i) => {
    const mapping =
      mappings.find((m) => m.atlas_event === e.event_name) ??
      ({ atlas_event: e.event_name, provider_event: e.event_name } as EventMapping);
    const adjustment = formatGoogleAdjustment(e, mapping, identifiersPerEvent[i] ?? [], resource);
    adjustment.orderId = dedupResults[i].orderId;
    return adjustment;
  });

  const dmaEvents: DMAEvent[] = events.map((e, i) => toDMAEvent(adjustments[i], e));

  const request: DMAIngestEventsRequest = {
    events: dmaEvents,
    destinations: [{ type: 'GOOGLE_ADS', customerId: cleanCustomerId(creds.customer_id) }],
  };

  let accessToken = creds.oauth_access_token;
  let attempt = await sendDMAEventsRequest(request, accessToken, creds.login_customer_id);

  if (!attempt.ok && attempt.status === 401) {
    try {
      accessToken = await refreshGoogleToken(creds);
      attempt = await sendDMAEventsRequest(request, accessToken, creds.login_customer_id);
    } catch (refreshErr) {
      logger.warn(
        { err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr) },
        'Google DMA token refresh failed',
      );
    }
  }

  const { ok, body } = attempt;

  if (!ok) {
    const errMsg = (body as unknown as { error?: { message?: string; code?: number } }).error?.message ?? 'Google DMA API error';
    const errCode = (body as unknown as { error?: { code?: number } }).error?.code ?? 'DELIVERY_FAILED';
    return events.map((e, i) => ({
      event_id: e.event_id,
      status: 'failed' as const,
      provider_response: body,
      error_code: String(errCode),
      error_message: errMsg,
      dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
    }));
  }

  if (body.partialFailureError) {
    return events.map((e, i) => ({
      event_id: e.event_id,
      status: 'failed' as const,
      provider_response: body,
      error_code: 'PARTIAL_FAILURE',
      error_message: body.partialFailureError!.message,
      dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
    }));
  }

  // Build error map from DMA eventResults (keyed by eventIndex)
  const errorMap = new Map(
    (body.eventResults ?? [])
      .filter((r) => r.error)
      .map((r) => [r.eventIndex, r.error!]),
  );

  return events.map((e, i) => {
    const err = errorMap.get(i);
    if (err) {
      return {
        event_id: e.event_id,
        status: 'failed' as const,
        provider_response: body,
        error_code: String(err.code),
        error_message: err.message,
        dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
      };
    }
    return {
      event_id: e.event_id,
      status: 'delivered' as const,
      provider_response: body,
      dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
      dedup_key: providerId ? dedupResults[i].dedup_key : undefined,
      dedup_matched_at:
        dedupResults[i].dedup_status === 'hit' ? new Date().toISOString() : undefined,
    };
  });
}

// ── Test event ────────────────────────────────────────────────────────────────

export async function sendGoogleTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: GoogleCredentials,
): Promise<TestResult> {
  const resource = buildConversionActionResource(creds.customer_id, creds.conversion_action_id);
  const adjustment = formatGoogleAdjustment(event, mapping, identifiers, resource);
  const dmaEvent = toDMAEvent(adjustment, event);

  const request: DMAIngestEventsRequest = {
    events: [dmaEvent],
    destinations: [{ type: 'GOOGLE_ADS', customerId: cleanCustomerId(creds.customer_id) }],
    validateOnly: true,
  };

  try {
    const { ok, body } = await sendDMAEventsRequest(
      request,
      creds.oauth_access_token,
      creds.login_customer_id,
    );

    if (!ok) {
      const err = (body as unknown as { error?: { message?: string } }).error;
      return {
        status: 'failed',
        provider_response: body,
        error: err?.message ?? 'Google DMA validation failed',
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

export async function validateGoogleCredentials(
  creds: GoogleCredentials,
): Promise<ValidationResult> {
  if (!creds.customer_id || !creds.oauth_access_token || !creds.conversion_action_id) {
    return {
      valid: false,
      error: 'customer_id, oauth_access_token, and conversion_action_id are required',
    };
  }

  try {
    const res = await fetch(
      `${GOOGLE_OAUTH_TOKENINFO_URL}?access_token=${encodeURIComponent(creds.oauth_access_token)}`,
    );
    const body = await res.json() as {
      error?: string;
      error_description?: string;
      scope?: string;
    };

    if (!res.ok) {
      try {
        await refreshGoogleToken(creds);
        return { valid: true };
      } catch {
        return {
          valid: false,
          error: body.error_description ?? 'Invalid or expired access token',
        };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── Token refresh with expiry ─────────────────────────────────────────────────

export async function refreshGoogleTokenWithExpiry(
  creds: GoogleCredentials,
): Promise<{ access_token: string; expires_at: string }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required for token refresh',
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.oauth_refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const body = await res.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !body.access_token) {
    throw new Error(
      body.error_description ?? body.error ?? `Token refresh failed: HTTP ${res.status}`,
    );
  }

  const expiresInSec = body.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

  return { access_token: body.access_token, expires_at: expiresAt };
}
