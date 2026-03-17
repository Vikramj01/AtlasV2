/**
 * LinkedIn Conversions API — Frontend Adapter
 *
 * Implements CAPIProviderAdapter for LinkedIn CAPI.
 *
 * In the browser context:
 *   - formatEvent()           — pure function, builds the LinkedIn conversionEvent payload
 *   - validateCredentials()   — client-side field check only
 *   - sendEvents()            — routes through backend /api/capi/process
 *   - sendTestEvent()         — routes through backend /api/capi/providers/:id/test
 *
 * LinkedIn Conversions API reference:
 *   https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api
 */

import type {
  CAPIProviderAdapter,
  CAPIProvider,
  AtlasEvent,
  EventMapping,
  HashedIdentifier,
  ProviderPayload,
  ProviderCredentials,
  LinkedInCredentials,
  ValidationResult,
  DeliveryResult,
  TestResult,
} from '@/types/capi';

// ── LinkedIn-specific payload types ──────────────────────────────────────────

export interface LinkedInConversionEvent {
  /** URN of the conversion: "urn:lla:llaPartnerConversion:{conversion_id}" */
  conversion: string;
  /** Unix timestamp in milliseconds */
  conversionHappenedAt: number;
  conversionValue?: {
    currencyCode: string;
    amount: string; // decimal string, e.g. "49.99"
  };
  eventId?: string;
  user: {
    userIds: Array<
      | { idType: 'SHA256_EMAIL'; idValue: string }
      | { idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID'; idValue: string }
      | { idType: 'ACXIOM_ID'; idValue: string }
      | { idType: 'ORACLE_MOAT_ID'; idValue: string }
    >;
    userInfo?: {
      firstName?: string;   // SHA-256 hashed
      lastName?: string;    // SHA-256 hashed
      title?: string;
      companyName?: string;
      countryCode?: string;
    };
  };
}

// ── Standard LinkedIn conversion types ────────────────────────────────────────

export const LINKEDIN_EVENT_SUGGESTIONS: Record<string, string> = {
  purchase:          'PURCHASE',
  lead:              'LEAD',
  form_submit:       'LEAD',
  sign_up:           'SIGN_UP',
  registration:      'SIGN_UP',
  page_view:         'OTHER',
  subscribe:         'SIGN_UP',
  add_to_cart:       'ADD_TO_CART',
};

// ── Payload formatter (pure — no API calls) ───────────────────────────────────

/**
 * Build a LinkedIn CAPI conversionEvent payload from an AtlasEvent + hashed identifiers.
 */
export function formatLinkedInPayload(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
  conversionId: string,
): LinkedInConversionEvent {
  type LinkedInUserId = LinkedInConversionEvent['user']['userIds'][number];
  const userIds: LinkedInUserId[] = [];
  const userInfo: LinkedInConversionEvent['user']['userInfo'] = {};

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
      case 'country':
        userInfo.countryCode = id.value;
        break;
    }
  }

  const payload: LinkedInConversionEvent = {
    conversion: `urn:lla:llaPartnerConversion:${conversionId}`,
    conversionHappenedAt: event.event_time * 1000, // ms
    eventId: event.event_id,
    user: {
      userIds,
      ...(Object.keys(userInfo).length > 0 && { userInfo }),
    },
  };

  if (event.custom_data?.value !== undefined && event.custom_data?.currency) {
    payload.conversionValue = {
      currencyCode: event.custom_data.currency,
      amount: String(event.custom_data.value),
    };
  }

  void mapping;
  return payload;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class LinkedInAdapter implements CAPIProviderAdapter {
  readonly provider: CAPIProvider = 'linkedin';

  constructor(
    /** @internal reserved for future authenticated calls */
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const liCreds = creds as LinkedInCredentials;
    if (!liCreds.account_id || !liCreds.access_token || !liCreds.conversion_id) {
      return { valid: false, error: 'account_id, access_token, and conversion_id are required' };
    }
    return { valid: true };
  }

  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[],
  ): ProviderPayload {
    return {
      provider: 'linkedin',
      raw: formatLinkedInPayload(event, mapping, identifiers, 'unknown'),
    };
  }

  async sendEvents(
    payloads: ProviderPayload[],
    _creds: ProviderCredentials,
  ): Promise<DeliveryResult[]> {
    return payloads.map((p) => ({
      event_id: (p.raw as { eventId?: string }).eventId ?? 'unknown',
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
