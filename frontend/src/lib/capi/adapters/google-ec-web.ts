/**
 * Google Enhanced Conversions — Web Adapter
 *
 * name: 'google_ec_web'
 *
 * Use case:
 *   Real-time conversions from website events (purchase, sign_up, form_submit).
 *   Pairs with the backend CAPI pipeline which delivers adjustments to the
 *   Google Ads Enhanced Conversions API (conversionAdjustments:upload).
 *
 * Choose this adapter when:
 *   ✔ The conversion event fires on the website (thank-you page, checkout confirmation)
 *   ✔ You have first-party user data (email, phone) available at conversion time
 *   ✔ You want real-time, event-driven delivery
 *
 * vs EC Leads: EC Web fires at the moment of on-site conversion.
 *    EC Leads is for matching CRM leads to ad clicks after form submission.
 *
 * Consent signals required: ad_user_data, ad_personalization
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
import { formatGooglePayload } from './google';

export { GOOGLE_EVENT_SUGGESTIONS, GOOGLE_STANDARD_EVENTS } from './google';

// ── Adapter class ─────────────────────────────────────────────────────────────

export class GoogleECWebAdapter implements CAPIProviderAdapter {
  readonly name: CAPIAdapterName = 'google_ec_web';
  readonly provider: CAPIProvider = 'google';

  readonly requiredUserParams = ['event_name', 'event_time', 'event_source_url', 'action_source'];
  readonly optionalUserParams = [
    'email', 'phone', 'gclid', 'wbraid', 'gbraid',
    'client_user_agent', 'first_name', 'last_name', 'city', 'state', 'zip', 'country',
  ];
  readonly dedupStrategy = { key: ['event_name', 'order_id'], window_seconds: 86400 };
  readonly retryPolicy = { max_attempts: 3, backoff: 'exponential' as const, base_ms: 1000 };
  readonly consentSignals = ['ad_user_data', 'ad_personalization'];
  readonly testMode = { supported: true, credentialField: null as string | null };

  constructor(
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const g = creds as GoogleCredentials;
    if (!g.customer_id || !g.oauth_access_token || !g.conversion_action_id) {
      return { valid: false, error: 'customer_id, oauth_access_token, and conversion_action_id are required' };
    }
    if (!g.oauth_refresh_token) {
      return { valid: false, error: 'oauth_refresh_token is required for automatic token renewal' };
    }
    return { valid: true };
  }

  buildPayload(event: AtlasEvent, creds: ProviderCredentials, _consent: ConsentDecisions): ProviderPayload {
    const g = creds as GoogleCredentials;
    const mapping: EventMapping = { atlas_event: event.event_name, provider_event: event.event_name };
    return { provider: 'google', raw: formatGooglePayload(event, mapping, [], g) };
  }

  validatePayload(payload: ProviderPayload): ValidationResult {
    const adj = payload.raw as GoogleConversionAdjustment;
    if (!adj.conversionAction) {
      return { valid: false, error: 'conversionAction is required' };
    }
    if (!adj.userIdentifiers?.length) {
      return { valid: true, details: { warnings: ['No user identifiers — match quality will be low. Add email or phone.'] } };
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
    const adj = payload.raw as GoogleConversionAdjustment;
    let score = 0;
    for (const uid of adj.userIdentifiers ?? []) {
      if ('hashedEmail' in uid)           score += 4;
      else if ('hashedPhoneNumber' in uid) score += 3;
      else if ('addressInfo' in uid)      score += 2;
    }
    if (adj.gclidDateTimePair?.gclid) score += 1;
    return Math.min(10, score);
  }

  // ── Legacy methods (kept for backward compat) ──────────────────────────────

  formatEvent(event: AtlasEvent, mapping: EventMapping, identifiers: HashedIdentifier[]): ProviderPayload {
    const g = { customer_id: '', oauth_access_token: '', oauth_refresh_token: '', conversion_action_id: 'unknown' };
    return { provider: 'google', raw: formatGooglePayload(event, mapping, identifiers, g) };
  }

  async sendEvents(payloads: ProviderPayload[], _creds: ProviderCredentials): Promise<DeliveryResult[]> {
    return payloads.map((p) => ({
      event_id: (p.raw as { orderId?: string }).orderId ?? 'unknown',
      status: 'failed' as const,
      provider_response: null,
      error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED',
      error_message: 'Events must be delivered via the backend pipeline (/api/capi/process)',
    }));
  }

  async sendTestEvent(_payload: ProviderPayload, _creds: ProviderCredentials): Promise<TestResult> {
    return {
      status: 'failed',
      provider_response: null,
      error: 'Use POST /api/capi/providers/:id/test to send test events',
    };
  }
}
