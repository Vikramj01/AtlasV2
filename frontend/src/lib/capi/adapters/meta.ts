/**
 * Meta Conversions API — Frontend Adapter
 *
 * Implements CAPIProviderAdapter for Meta (Facebook).
 *
 * In the browser context:
 *   - formatEvent()           — pure function, builds the Meta payload shape
 *   - validateCredentials()   — routes through backend /api/capi/providers (POST)
 *   - sendEvents()            — routes through backend /api/capi/process
 *   - sendTestEvent()         — routes through backend /api/capi/providers/:id/test
 *
 * This adapter is used by:
 *   - SetupWizard (Step 4 — TestVerify): preview formatted payload, run test
 *   - CAPIMonitoringDashboard: payload inspection
 */

import type {
  CAPIProviderAdapter,
  CAPIProvider,
  AtlasEvent,
  EventMapping,
  HashedIdentifier,
  ProviderPayload,
  ProviderCredentials,
  MetaCredentials,
  MetaEventPayload,
  ValidationResult,
  DeliveryResult,
  TestResult,
  EMQReport,
} from '@/types/capi';

const META_STANDARD_EVENTS = [
  'Purchase', 'Lead', 'CompleteRegistration', 'AddToCart', 'InitiateCheckout',
  'AddPaymentInfo', 'Search', 'ViewContent', 'PageView', 'Contact',
  'CustomizeProduct', 'Donate', 'FindLocation', 'Schedule', 'StartTrial',
  'SubmitApplication', 'Subscribe',
] as const;

export type MetaStandardEvent = typeof META_STANDARD_EVENTS[number];

export const META_EVENT_SUGGESTIONS: Record<string, MetaStandardEvent> = {
  purchase:           'Purchase',
  order_complete:     'Purchase',
  checkout_complete:  'Purchase',
  lead:               'Lead',
  form_submit:        'Lead',
  sign_up:            'CompleteRegistration',
  registration:       'CompleteRegistration',
  add_to_cart:        'AddToCart',
  checkout_start:     'InitiateCheckout',
  add_payment:        'AddPaymentInfo',
  search:             'Search',
  product_view:       'ViewContent',
  page_view:          'PageView',
};

// ── Payload formatter (pure — no API calls) ───────────────────────────────────

export function formatMetaPayload(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
): MetaEventPayload['data'][number] {
  const userData: MetaEventPayload['data'][number]['user_data'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       (userData.em ??= []).push(id.value); break;
      case 'phone':       (userData.ph ??= []).push(id.value); break;
      case 'fn':          (userData.fn ??= []).push(id.value); break;
      case 'ln':          (userData.ln ??= []).push(id.value); break;
      case 'ct':          (userData.ct ??= []).push(id.value); break;
      case 'st':          (userData.st ??= []).push(id.value); break;
      case 'zp':          (userData.zp ??= []).push(id.value); break;
      case 'country':     (userData.country ??= []).push(id.value); break;
      case 'external_id': (userData.external_id ??= []).push(id.value); break;
      case 'fbc':         userData.fbc = id.value; break;
      case 'fbp':         userData.fbp = id.value; break;
    }
  }

  if (event.user_data.client_user_agent) userData.client_user_agent = event.user_data.client_user_agent;
  if (event.user_data.client_ip_address) userData.client_ip_address = event.user_data.client_ip_address;

  const formatted: MetaEventPayload['data'][number] = {
    event_name: mapping.provider_event,
    event_time: event.event_time,
    event_id: event.event_id,
    event_source_url: event.event_source_url,
    action_source: event.action_source,
    user_data: userData,
  };

  if (event.custom_data) {
    formatted.custom_data = {
      value:        event.custom_data.value,
      currency:     event.custom_data.currency,
      content_type: event.custom_data.content_type,
      content_ids:  event.custom_data.content_ids,
      order_id:     event.custom_data.order_id,
      num_items:    event.custom_data.num_items,
    };
  }

  return formatted;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class MetaAdapter implements CAPIProviderAdapter {
  readonly provider: CAPIProvider = 'meta';

  private readonly apiBase: string;
  private readonly getAuthHeader: () => Promise<string>;

  constructor(apiBase: string, getAuthHeader: () => Promise<string>) {
    this.apiBase = apiBase;
    this.getAuthHeader = getAuthHeader;
  }

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const metaCreds = creds as MetaCredentials;
    if (!metaCreds.pixel_id || !metaCreds.access_token) {
      return { valid: false, error: 'pixel_id and access_token are required' };
    }
    // Validation happens server-side on POST /api/capi/providers
    return { valid: true };
  }

  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[],
  ): ProviderPayload {
    return {
      provider: 'meta',
      raw: formatMetaPayload(event, mapping, identifiers),
    };
  }

  async sendEvents(
    payloads: ProviderPayload[],
    _creds: ProviderCredentials,
  ): Promise<DeliveryResult[]> {
    // Delivery is handled server-side via POST /api/capi/process
    // This method is a stub — the real path goes through the pipeline
    return payloads.map(p => ({
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
    _testCode?: string,
  ): Promise<TestResult> {
    return {
      status: 'failed',
      provider_response: null,
      error: 'Use POST /api/capi/providers/:id/test to send test events',
    };
  }

  async getEventMatchQuality(_creds: ProviderCredentials): Promise<EMQReport> {
    const auth = await this.getAuthHeader();
    const res = await fetch(`${this.apiBase}/api/capi/emq`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) throw new Error('Failed to fetch EMQ report');
    return res.json() as Promise<EMQReport>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export { META_STANDARD_EVENTS };

/** Estimate Event Match Quality score (0-10) based on identifier count. */
export function estimateEMQ(identifiers: HashedIdentifier[]): number {
  const hashedTypes = new Set(identifiers.filter(i => i.is_hashed).map(i => i.type));
  let score = 0;
  if (hashedTypes.has('email'))   score += 3;
  if (hashedTypes.has('phone'))   score += 2;
  if (identifiers.some(i => i.type === 'fbc'))  score += 2;
  if (identifiers.some(i => i.type === 'fbp'))  score += 1;
  if (hashedTypes.has('fn') && hashedTypes.has('ln')) score += 1;
  if (hashedTypes.has('external_id')) score += 1;
  return Math.min(10, score);
}
