/**
 * Google Enhanced Conversions — Leads Adapter
 *
 * name: 'google_ec_leads'
 *
 * Use case:
 *   Match CRM leads to ad clicks after form submission. Conversions happen
 *   offline (sales team follow-up, phone call, in-person appointment).
 *   Uploads hashed user identifiers paired with the GCLID from the originating click.
 *
 * Choose this adapter when:
 *   ✔ Your conversion is a qualified lead, not an on-site purchase
 *   ✔ You match leads from your CRM to ad clicks (email/phone + gclid)
 *   ✔ The conversion happens after the form submission (hours to days later)
 *
 * vs EC Web: EC Web fires immediately at on-site conversion.
 *    EC Leads is for offline/delayed lead qualification.
 *
 * Recommended identifiers: email (required) + gclid (strongly recommended).
 * Without gclid, match rate is ~30–60%. With gclid, expect 70–90%.
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

export class GoogleECLeadsAdapter implements CAPIProviderAdapter {
  readonly name: CAPIAdapterName = 'google_ec_leads';
  readonly provider: CAPIProvider = 'google';

  // Lead matching emphasises email + gclid. Phone and address boost confidence.
  readonly requiredUserParams = ['event_name', 'event_time', 'email'];
  readonly optionalUserParams = [
    'gclid', 'wbraid', 'gbraid',
    'phone', 'first_name', 'last_name', 'city', 'state', 'zip', 'country',
    'client_user_agent',
  ];
  readonly dedupStrategy = { key: ['event_name', 'order_id', 'gclid'], window_seconds: 86400 };
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
    const warnings: string[] = [];
    const hasEmail = adj.userIdentifiers?.some((u) => 'hashedEmail' in u);
    if (!hasEmail) {
      warnings.push('Email is strongly recommended for lead matching — without it match rates will be very low');
    }
    if (!adj.gclidDateTimePair?.gclid) {
      warnings.push('gclid missing — include the Google Click ID for 70–90% match rates');
    }
    if (warnings.length > 0) {
      return { valid: true, details: { warnings } };
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
    if (adj.gclidDateTimePair?.gclid) score += 2; // Higher weight for leads — gclid is critical
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
