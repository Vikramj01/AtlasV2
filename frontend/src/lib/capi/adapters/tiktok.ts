/**
 * TikTok Events API — Frontend Adapter
 *
 * Implements CAPIProviderAdapter for TikTok Pixel (Events API v2).
 *
 * In the browser context:
 *   - formatEvent()           — pure function, builds the TikTok Events API payload
 *   - validateCredentials()   — client-side field check only
 *   - sendEvents()            — routes through backend /api/capi/process
 *   - sendTestEvent()         — routes through backend /api/capi/providers/:id/test
 *
 * TikTok Events API v2 reference:
 *   https://ads.tiktok.com/marketing_api/docs?id=1741601162187777
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
  TikTokCredentials,
  ValidationResult,
  DeliveryResult,
  SendResult,
  TestResult,
} from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';

// ── TikTok-specific payload types ────────────────────────────────────────────

export interface TikTokEventPayload {
  pixel_code: string;
  event: string;
  event_id?: string;
  timestamp: string;          // ISO 8601
  context: {
    user: {
      email?: string;         // SHA-256 hashed
      phone_number?: string;  // SHA-256 hashed (E.164 format)
      external_id?: string;   // SHA-256 hashed
    };
    user_agent?: string;
    ip?: string;
    page?: { url?: string };
  };
  properties?: {
    currency?: string;
    value?: number;
    contents?: Array<{ content_id?: string; quantity?: number; price?: number }>;
    order_id?: string;
  };
  partner_name: 'AtlasV2';
}

// ── Standard TikTok event names ────────────────────────────────────────────────

export const TIKTOK_STANDARD_EVENTS = [
  'Purchase', 'InitiateCheckout', 'AddToCart', 'ViewContent',
  'Search', 'AddPaymentInfo', 'Subscribe', 'Registration',
  'Contact', 'SubmitForm', 'Download', 'PageView',
] as const;

export type TikTokStandardEvent = typeof TIKTOK_STANDARD_EVENTS[number];

export const TIKTOK_EVENT_SUGGESTIONS: Record<string, TikTokStandardEvent> = {
  purchase:          'Purchase',
  order_complete:    'Purchase',
  checkout_complete: 'Purchase',
  checkout_start:    'InitiateCheckout',
  add_to_cart:       'AddToCart',
  product_view:      'ViewContent',
  search:            'Search',
  add_payment:       'AddPaymentInfo',
  subscribe:         'Subscribe',
  sign_up:           'Registration',
  registration:      'Registration',
  form_submit:       'SubmitForm',
  lead:              'SubmitForm',
  page_view:         'PageView',
};

// ── Payload formatter (pure — no API calls) ───────────────────────────────────

/**
 * Build a TikTok Events API v2 payload from an AtlasEvent + hashed identifiers.
 */
export function formatTikTokPayload(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
): TikTokEventPayload {
  const user: TikTokEventPayload['context']['user'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       user.email        = id.value; break;
      case 'phone':       user.phone_number = id.value; break;
      case 'external_id': user.external_id  = id.value; break;
    }
  }

  const payload: TikTokEventPayload = {
    pixel_code: '',       // Set by caller with creds.pixel_id
    event: mapping.provider_event,
    event_id: event.event_id,
    timestamp: new Date(event.event_time * 1000).toISOString(),
    context: {
      user,
      ...(event.user_data.client_user_agent && { user_agent: event.user_data.client_user_agent }),
      ...(event.user_data.client_ip_address && { ip: event.user_data.client_ip_address }),
      ...(event.event_source_url && { page: { url: event.event_source_url } }),
    },
    partner_name: 'AtlasV2',
  };

  if (event.custom_data) {
    payload.properties = {
      ...(event.custom_data.currency && { currency: event.custom_data.currency }),
      ...(event.custom_data.value !== undefined && { value: event.custom_data.value }),
      ...(event.custom_data.order_id && { order_id: event.custom_data.order_id }),
    };
  }

  return payload;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class TikTokAdapter implements CAPIProviderAdapter {
  // ── Contract metadata ──────────────────────────────────────────────────────
  readonly name: CAPIAdapterName = 'tiktok';
  readonly provider: CAPIProvider = 'tiktok';

  readonly requiredUserParams = ['event_name', 'event_time'];
  readonly optionalUserParams = ['email', 'phone', 'external_id', 'client_user_agent', 'client_ip_address'];
  readonly dedupStrategy = { key: ['event_name', 'event_id'], window_seconds: 86400 };
  readonly retryPolicy = { max_attempts: 3, backoff: 'exponential' as const, base_ms: 1000 };
  readonly consentSignals = ['marketing'];
  readonly testMode = { supported: false, credentialField: null as string | null };

  constructor(
    /** @internal reserved for future authenticated calls */
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  // ── Lifecycle: new contract ────────────────────────────────────────────────

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const tiktokCreds = creds as TikTokCredentials;
    if (!tiktokCreds.pixel_id || !tiktokCreds.access_token) {
      return { valid: false, error: 'pixel_id and access_token are required' };
    }
    return { valid: true };
  }

  buildPayload(event: AtlasEvent, _creds: ProviderCredentials, _consent: ConsentDecisions): ProviderPayload {
    const mapping: EventMapping = { atlas_event: event.event_name, provider_event: event.event_name };
    return { provider: 'tiktok', raw: formatTikTokPayload(event, mapping, []) };
  }

  validatePayload(payload: ProviderPayload): ValidationResult {
    const data = payload.raw as TikTokEventPayload;
    if (!data.event) return { valid: false, error: 'event name is required' };
    return { valid: true };
  }

  async send(_payload: ProviderPayload, _creds: ProviderCredentials): Promise<SendResult> {
    return {
      event_id: (_payload.raw as { event_id?: string }).event_id ?? 'unknown',
      status: 'failed',
      provider_response: null,
      error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED',
      error_message: 'Events must be delivered via the backend pipeline (/api/capi/process)',
    };
  }

  computeMatchQuality(payload: ProviderPayload): number {
    const data = payload.raw as TikTokEventPayload;
    let score = 0;
    if (data.context?.user?.email)        score += 4;
    if (data.context?.user?.phone_number) score += 3;
    if (data.context?.user?.external_id)  score += 2;
    if (data.context?.ip)                 score += 1;
    return Math.min(10, score);
  }

  // ── Lifecycle: legacy ──────────────────────────────────────────────────────

  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[],
  ): ProviderPayload {
    return {
      provider: 'tiktok',
      raw: formatTikTokPayload(event, mapping, identifiers),
    };
  }

  async sendEvents(
    payloads: ProviderPayload[],
    _creds: ProviderCredentials,
  ): Promise<DeliveryResult[]> {
    return payloads.map((p) => ({
      event_id: (p.raw as { event_id?: string }).event_id ?? 'unknown',
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
