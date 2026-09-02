/**
 * Google Enhanced Conversions — Delivery Service (DMA)
 *
 * Sends conversion events to the Google Data Manager API:
 *   POST https://datamanager.googleapis.com/v1/events:ingest
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → DMAEvent (via dmaEventBuilder.ts,
 *     shared with googleOfflineUpload.ts)
 *   - OAuth access token refresh (using stored refresh token + GOOGLE_OAUTH_CLIENT_* env vars)
 *   - Credential validation via Google tokeninfo endpoint
 *   - validateOnly mode for test events
 *
 * The live events:ingest response only confirms submission (requestId +
 * fieldWarnings) — it does not return per-event delivered/failed status.
 * See sendGoogleEvents()'s inline comment for the resulting scope boundary.
 */

import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  GoogleCredentials,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import type {
  DMADestination,
  DMAIngestEventsRequest,
  DMAIngestEventsResponse,
} from '@/integrations/google/dmaTypes';
import { buildDMAEvent } from '@/integrations/google/dmaEventBuilder';
import logger from '@/utils/logger';
import { getGoogleDedupEntry } from './dedupStore';

const DMA_BASE_URL = 'https://datamanager.googleapis.com/v1';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

/**
 * DMA destinations for a Google credential set. Google Ads is always included
 * (conversion action ID goes on Destination.productDestinationId — the live
 * API moved this off the Event resource entirely); GA4 is added alongside it
 * when a property ID is configured, so the same `events:ingest` call lands
 * the conversion in both destinations in one round-trip.
 */
export function buildGoogleDestinations(creds: GoogleCredentials): DMADestination[] {
  const destinations: DMADestination[] = [
    {
      operatingAccount: { accountId: cleanCustomerId(creds.customer_id), accountType: 'GOOGLE_ADS' },
      productDestinationId: creds.conversion_action_id,
    },
  ];
  if (creds.ga4_property_id) {
    destinations.push({
      operatingAccount: { accountId: creds.ga4_property_id, accountType: 'GOOGLE_ANALYTICS_PROPERTY' },
    });
  }
  return destinations;
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
  // mappings kept for call-site signature compatibility with the other
  // provider adapters — Google/DMA has no event-name mapping concept
  // (eventName is sent as Atlas's own canonical name), same as before this fix.
  void mappings;

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
      // Reuse a prior gclid-keyed dedup entry's orderId when present; otherwise
      // fall back to the canonical atlas event_id (not a throwaway UUID) so the
      // transactionId sent to Google traces back to the same business event as
      // every other destination.
      const orderId = entry?.event_id ?? e.event_id;
      const dedupStatus: 'hit' | 'miss' = entry ? 'hit' : 'miss';
      const dedupKey =
        providerId && entry && gclid
          ? `${providerId}:${gclid}:${e.event_name}`
          : undefined;

      return { orderId, dedup_status: dedupStatus, dedup_key: dedupKey };
    }),
  );

  const dmaEvents = events.map((e, i) =>
    buildDMAEvent(e, identifiersPerEvent[i] ?? [], { transactionId: dedupResults[i].orderId }),
  );

  const request: DMAIngestEventsRequest = {
    events: dmaEvents,
    destinations: buildGoogleDestinations(creds),
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
    return events.map((_e, i) => ({
      event_id: dedupResults[i].orderId,
      status: 'failed' as const,
      provider_response: body,
      error_code: String(errCode),
      error_message: errMsg,
      dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
    }));
  }

  // The live events:ingest response is submit-confirmation only
  // ({ requestId, fieldWarnings }) — there is no per-event success/failure
  // array (that model does not exist on this API anymore; the old
  // eventResults/partialFailureError handling here was itself part of the
  // schema drift this fix corrects). A 2xx response means the batch was
  // accepted for processing, not that every event was confirmed delivered —
  // true per-event confirmation requires polling requestStatus:retrieve on a
  // delay, which is out of scope here (see the incident writeup). Treat a
  // successful submission as 'delivered'; log fieldWarnings for visibility
  // without failing the batch, since warnings aren't necessarily rejections.
  if (body.fieldWarnings && body.fieldWarnings.length > 0) {
    logger.warn({ providerId, warnings: body.fieldWarnings }, 'Google DMA: events:ingest returned field warnings');
  }

  return events.map((_e, i) => ({
    event_id: dedupResults[i].orderId,
    status: 'delivered' as const,
    provider_response: body,
    dedup_status: providerId ? dedupResults[i].dedup_status : undefined,
    dedup_key: providerId ? dedupResults[i].dedup_key : undefined,
    dedup_matched_at:
      dedupResults[i].dedup_status === 'hit' ? new Date().toISOString() : undefined,
  }));
}

// ── Test event ────────────────────────────────────────────────────────────────

export async function sendGoogleTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: GoogleCredentials,
): Promise<TestResult> {
  void mapping; // kept for call-site signature compatibility, see sendGoogleEvents
  const dmaEvent = buildDMAEvent(event, identifiers);

  const request: DMAIngestEventsRequest = {
    events: [dmaEvent],
    destinations: buildGoogleDestinations(creds),
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
