/**
 * Google Enhanced Conversions — Frontend Adapter
 *
 * Implements CAPIProviderAdapter for Google Ads Enhanced Conversions.
 *
 * In the browser context:
 *   - formatEvent()           — pure function, builds a GoogleConversionAdjustment
 *   - validateCredentials()   — client-side field check only (server validates OAuth token)
 *   - sendEvents()            — routes through backend /api/capi/process
 *   - sendTestEvent()         — routes through backend /api/capi/providers/:id/test
 *
 * This adapter is used by:
 *   - SetupWizard (Step 4 — TestVerify): payload preview
 */

import type {
  CAPIProviderAdapter,
  CAPIAdapterName,
  CAPIProvider,
  AtlasEvent,
  EventMapping,
  HashedIdentifier,
  ProviderPayload,
  ProviderCredentials,
  GoogleCredentials,
  GoogleConversionAdjustment,
  ValidationResult,
  DeliveryResult,
  SendResult,
  TestResult,
} from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';

// ── Event name suggestions ─────────────────────────────────────────────────────
// Maps Atlas event names to Google Ads conversion action types.
// These are advisory — the actual mapping is configured by the user in MapEvents.

export const GOOGLE_EVENT_SUGGESTIONS: Record<string, string> = {
  purchase:          'PURCHASE',
  order_complete:    'PURCHASE',
  checkout_complete: 'PURCHASE',
  lead:              'SUBMIT_LEAD_FORM',
  form_submit:       'SUBMIT_LEAD_FORM',
  sign_up:           'SIGNUP',
  registration:      'SIGNUP',
  subscribe:         'SUBSCRIBE',
  add_to_cart:       'ADD_TO_CART',
  checkout_start:    'BEGIN_CHECKOUT',
  page_view:         'PAGE_VIEW',
};

// ── Payload formatter (pure — no API calls) ───────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

/**
 * Build a GoogleConversionAdjustment from an AtlasEvent + hashed identifiers.
 * This mirrors the backend `formatGoogleAdjustment()` for payload previews in the wizard.
 */
export function formatGooglePayload(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  creds: GoogleCredentials,
): GoogleConversionAdjustment {
  const conversionAction = `customers/${cleanCustomerId(creds.customer_id)}/conversionActions/${creds.conversion_action_id}`;

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
      case 'fn': addressInfo.hashedFirstName = id.value; hasAddressField = true; break;
      case 'ln': addressInfo.hashedLastName  = id.value; hasAddressField = true; break;
      case 'ct': addressInfo.city            = id.value; hasAddressField = true; break;
      case 'st': addressInfo.state           = id.value; hasAddressField = true; break;
      case 'zp': addressInfo.postalCode      = id.value; hasAddressField = true; break;
      case 'country': addressInfo.countryCode = id.value; hasAddressField = true; break;
    }
  }

  if (hasAddressField) {
    userIdentifiers.push({ addressInfo });
  }

  const adjustment: GoogleConversionAdjustment = {
    adjustmentType: 'ENHANCEMENT',
    conversionAction,
    userIdentifiers,
  };

  if (event.user_data.gclid) {
    const dt = new Date(event.event_time * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '+00:00');
    adjustment.gclidDateTimePair = { gclid: event.user_data.gclid, conversionDateTime: dt };
  }

  if (event.custom_data?.order_id) {
    adjustment.orderId = event.custom_data.order_id;
  }

  if (event.user_data.client_user_agent) {
    adjustment.userAgent = event.user_data.client_user_agent;
  }

  void mapping;
  return adjustment;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class GoogleAdapter implements CAPIProviderAdapter {
  // ── Contract metadata ──────────────────────────────────────────────────────
  readonly name: CAPIAdapterName = 'google';
  readonly provider: CAPIProvider = 'google';

  readonly requiredUserParams = ['event_name', 'event_time', 'event_source_url', 'action_source'];
  readonly optionalUserParams = ['email', 'phone', 'gclid', 'wbraid', 'gbraid', 'client_user_agent'];
  readonly dedupStrategy = { key: ['event_name', 'order_id'], window_seconds: 86400 };
  readonly retryPolicy = { max_attempts: 3, backoff: 'exponential' as const, base_ms: 1000 };
  readonly consentSignals = ['analytics', 'ad_user_data', 'ad_personalization'];
  readonly testMode = { supported: true, credentialField: null as string | null };

  constructor(
    /** @internal reserved for future authenticated calls */
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  // ── Lifecycle: new contract ────────────────────────────────────────────────

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const googleCreds = creds as GoogleCredentials;
    if (!googleCreds.customer_id || !googleCreds.oauth_access_token || !googleCreds.conversion_action_id) {
      return { valid: false, error: 'customer_id, oauth_access_token, and conversion_action_id are required' };
    }
    return { valid: true };
  }

  buildPayload(event: AtlasEvent, creds: ProviderCredentials, _consent: ConsentDecisions): ProviderPayload {
    const googleCreds = creds as GoogleCredentials;
    const mapping: EventMapping = { atlas_event: event.event_name, provider_event: event.event_name };
    return {
      provider: 'google',
      raw: formatGooglePayload(event, mapping, [], googleCreds),
    };
  }

  validatePayload(payload: ProviderPayload): ValidationResult {
    const adjustment = payload.raw as GoogleConversionAdjustment;
    if (!adjustment.conversionAction) {
      return { valid: false, error: 'conversionAction is required' };
    }
    if (!adjustment.userIdentifiers?.length) {
      return { valid: true, details: { warnings: ['No user identifiers — match quality will be low'] } };
    }
    return { valid: true };
  }

  async send(_payload: ProviderPayload, _creds: ProviderCredentials): Promise<SendResult> {
    return {
      event_id: (_payload.raw as { orderId?: string }).orderId ?? 'unknown',
      status: 'failed',
      provider_response: null,
      error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED',
      error_message: 'Events must be delivered via the backend pipeline (/api/capi/process)',
    };
  }

  computeMatchQuality(payload: ProviderPayload): number {
    const adjustment = payload.raw as GoogleConversionAdjustment;
    let score = 0;
    for (const uid of adjustment.userIdentifiers ?? []) {
      if ('hashedEmail' in uid)        score += 4;
      else if ('hashedPhoneNumber' in uid) score += 3;
      else if ('addressInfo' in uid)   score += 2;
    }
    if (adjustment.gclidDateTimePair?.gclid) score += 1;
    return Math.min(10, score);
  }

  // ── Lifecycle: legacy ──────────────────────────────────────────────────────

  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[],
  ): ProviderPayload {
    const googleCreds = { customer_id: '', oauth_access_token: '', oauth_refresh_token: '', conversion_action_id: 'unknown' };
    return {
      provider: 'google',
      raw: formatGooglePayload(event, mapping, identifiers, googleCreds),
    };
  }

  async sendEvents(
    payloads: ProviderPayload[],
    _creds: ProviderCredentials,
  ): Promise<DeliveryResult[]> {
    return payloads.map((p) => ({
      event_id: (p.raw as { orderId?: string }).orderId ?? 'unknown',
      status: 'failed' as const,
      provider_response: null,
      error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED',
      error_message: 'Events must be delivered via the backend pipeline (/api/capi/process)',
    }));
  }

  async sendTestEvent(
    _payload: ProviderPayload,
    _creds: ProviderCredentials,
  ): Promise<TestResult> {
    return {
      status: 'failed',
      provider_response: null,
      error: 'Use POST /api/capi/providers/:id/test to send test events',
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Deduplicated list of Google Ads conversion action types — used as dropdown
// options in MapEvents.tsx. Must be readonly string[] to match META_STANDARD_EVENTS shape.
export const GOOGLE_STANDARD_EVENTS = [
  'PURCHASE',
  'SUBMIT_LEAD_FORM',
  'SIGNUP',
  'SUBSCRIBE',
  'ADD_TO_CART',
  'BEGIN_CHECKOUT',
  'PAGE_VIEW',
] as const;
