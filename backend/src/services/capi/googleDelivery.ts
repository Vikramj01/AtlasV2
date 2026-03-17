/**
 * Google Enhanced Conversions — Delivery Service
 *
 * Sends Enhanced Conversion adjustments to the Google Ads API:
 *   POST https://googleads.googleapis.com/v17/customers/{customerId}/conversionAdjustments:upload
 *
 * Handles:
 *   - Payload formatting from AtlasEvent → GoogleConversionAdjustment
 *   - OAuth access token refresh (using stored refresh token + GOOGLE_OAUTH_CLIENT_* env vars)
 *   - Partial failure detection from Google's response envelope
 *   - Credential validation via tokeninfo endpoint
 *
 * Optional env vars (required for token refresh):
 *   GOOGLE_OAUTH_CLIENT_ID       — Google OAuth client ID
 *   GOOGLE_OAUTH_CLIENT_SECRET   — Google OAuth client secret
 *   GOOGLE_ADS_DEVELOPER_TOKEN   — Google Ads developer token (required for every request)
 */

import type {
  AtlasEvent,
  HashedIdentifier,
  EventMapping,
  GoogleCredentials,
  GoogleConversionAdjustment,
  GoogleUploadRequest,
  TestResult,
  DeliveryResult,
  ValidationResult,
} from '@/types/capi';
import logger from '@/utils/logger';

const GOOGLE_ADS_API_VERSION = 'v17';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

function buildConversionActionResource(customerId: string, conversionActionId: string): string {
  return `customers/${cleanCustomerId(customerId)}/conversionActions/${conversionActionId}`;
}

function unixToGoogleDateTime(unixSeconds: number): string {
  // Format: "yyyy-mm-dd HH:mm:ss+00:00"
  return new Date(unixSeconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+00:00');
}

// ── OAuth token refresh ───────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Use the stored refresh token + GOOGLE_OAUTH_CLIENT_* env vars to obtain a
 * fresh access token. Throws if env vars are missing or the refresh fails.
 */
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

// ── Payload formatting ────────────────────────────────────────────────────────

/**
 * Format a single AtlasEvent + hashed identifiers into a
 * GoogleConversionAdjustment (Enhanced Conversions payload).
 */
export function formatGoogleAdjustment(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  conversionActionResourceName: string,
): GoogleConversionAdjustment {
  // Build userIdentifiers, merging address fields into a single addressInfo entry
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
      // Click IDs and other types are not used in userIdentifiers
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

  // Attach gclid + conversion timestamp if available
  if (event.user_data.gclid) {
    adjustment.gclidDateTimePair = {
      gclid: event.user_data.gclid,
      conversionDateTime: unixToGoogleDateTime(event.event_time),
    };
  }

  // Attach order ID for deduplication
  if (event.custom_data?.order_id) {
    adjustment.orderId = event.custom_data.order_id;
  }

  // Attach user agent
  if (event.user_data.client_user_agent) {
    adjustment.userAgent = event.user_data.client_user_agent;
  }

  void mapping; // The outer pipeline logs the mapped provider_event name; not needed here
  return adjustment;
}

// ── HTTP upload ───────────────────────────────────────────────────────────────

interface GoogleAdsUploadResponse {
  results?: Array<{ adjustmentType?: string }>;
  partialFailureError?: {
    code: number;
    message: string;
    details: unknown[];
  };
  error?: {
    code: number;
    message: string;
    status: string;
    details: unknown[];
  };
}

function buildUploadHeaders(creds: GoogleCredentials, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
  };
  if (creds.login_customer_id) {
    headers['login-customer-id'] = cleanCustomerId(creds.login_customer_id);
  }
  return headers;
}

async function uploadAdjustments(
  adjustments: GoogleConversionAdjustment[],
  creds: GoogleCredentials,
  accessToken: string,
  validateOnly = false,
): Promise<{ ok: boolean; status: number; body: GoogleAdsUploadResponse }> {
  const cid = cleanCustomerId(creds.customer_id);
  const baseUrl = `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${cid}/conversionAdjustments:upload`;
  const url = validateOnly ? `${baseUrl}?validateOnly=true` : baseUrl;

  const uploadRequest: GoogleUploadRequest = {
    conversionAdjustments: adjustments,
    partialFailure: !validateOnly,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: buildUploadHeaders(creds, accessToken),
    body: JSON.stringify(uploadRequest),
  });

  const body = await res.json() as GoogleAdsUploadResponse;
  return { ok: res.ok, status: res.status, body };
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Send a batch of AtlasEvents to Google Enhanced Conversions.
 * Retries once with a refreshed token on 401.
 */
export async function sendGoogleEvents(
  events: AtlasEvent[],
  identifiersPerEvent: HashedIdentifier[][],
  mappings: EventMapping[],
  creds: GoogleCredentials,
): Promise<DeliveryResult[]> {
  if (events.length === 0) return [];

  const resource = buildConversionActionResource(creds.customer_id, creds.conversion_action_id);

  const adjustments = events.map((e, i) => {
    const mapping =
      mappings.find((m) => m.atlas_event === e.event_name) ??
      ({ atlas_event: e.event_name, provider_event: e.event_name } as EventMapping);
    return formatGoogleAdjustment(e, mapping, identifiersPerEvent[i] ?? [], resource);
  });

  let accessToken = creds.oauth_access_token;
  let attempt = await uploadAdjustments(adjustments, creds, accessToken);

  // Retry with refreshed token on 401
  if (!attempt.ok && attempt.status === 401) {
    try {
      accessToken = await refreshGoogleToken(creds);
      attempt = await uploadAdjustments(adjustments, creds, accessToken);
    } catch (refreshErr) {
      logger.warn({ err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr) }, 'Google token refresh failed');
    }
  }

  const { ok, body } = attempt;

  if (!ok) {
    const errMsg = body.error?.message ?? 'Google Ads API error';
    return events.map((e) => ({
      event_id: e.event_id,
      status: 'failed' as const,
      provider_response: body,
      error_code: `${body.error?.code ?? 'DELIVERY_FAILED'}`,
      error_message: errMsg,
    }));
  }

  // Check partial failures (returned even on HTTP 200 with partialFailure: true)
  if (body.partialFailureError) {
    return events.map((e) => ({
      event_id: e.event_id,
      status: 'failed' as const,
      provider_response: body,
      error_code: 'PARTIAL_FAILURE',
      error_message: body.partialFailureError!.message,
    }));
  }

  return events.map((e) => ({
    event_id: e.event_id,
    status: 'delivered' as const,
    provider_response: body,
  }));
}

// ── Test event ────────────────────────────────────────────────────────────────

/**
 * Validate a single event against the Google Ads API using validateOnly=true.
 * Google Enhanced Conversions does not have a dedicated test mode, so this is
 * the closest equivalent — it validates the payload without recording data.
 */
export async function sendGoogleTestEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  mapping: EventMapping,
  creds: GoogleCredentials,
): Promise<TestResult> {
  const resource = buildConversionActionResource(creds.customer_id, creds.conversion_action_id);
  const adjustment = formatGoogleAdjustment(event, mapping, identifiers, resource);

  try {
    const { ok, body } = await uploadAdjustments([adjustment], creds, creds.oauth_access_token, true);

    if (!ok) {
      return {
        status: 'failed',
        provider_response: body,
        error: body.error?.message ?? 'Google Ads API validation failed',
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
 * Validate Google credentials by checking the access token via tokeninfo endpoint.
 * If the token is expired, attempts a refresh.
 */
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
    const body = await res.json() as { error?: string; error_description?: string; scope?: string; expires_in?: string };

    if (!res.ok) {
      // Token may be expired — try to refresh if we have the client credentials
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
