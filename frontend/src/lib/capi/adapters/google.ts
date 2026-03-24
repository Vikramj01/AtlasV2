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
  TestResult,
} from '@/types/capi';

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
  readonly provider: CAPIProvider = 'google';

  constructor(
    /** @internal reserved for future authenticated calls */
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const googleCreds = creds as GoogleCredentials;
    if (!googleCreds.customer_id || !googleCreds.oauth_access_token || !googleCreds.conversion_action_id) {
      return { valid: false, error: 'customer_id, oauth_access_token, and conversion_action_id are required' };
    }
    // Full token validation happens server-side on POST /api/capi/providers
    return { valid: true };
  }

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
    // Delivery is handled server-side via POST /api/capi/process
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
