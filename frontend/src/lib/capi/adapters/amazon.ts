/**
 * Amazon Ads Conversions API — Frontend Adapter
 *
 * Implements CAPIProviderAdapter for Amazon ACAPI.
 *
 * In the browser context:
 *   - buildPayload() / formatEvent()  — pure, builds the Amazon event payload
 *   - validateCredentials()           — client-side field check only
 *   - send()                          — routes through backend /api/capi/process
 *
 * Amazon Ads Conversions API reference:
 *   https://advertising.amazon.com/API/docs/en-us/guides/amazon-marketing-cloud/playbooks/off-amazon-conversions
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
  AmazonCredentials,
  AmazonConversionEvent,
  ValidationResult,
  DeliveryResult,
  SendResult,
  TestResult,
} from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';

// ── Payload formatter (pure — no API calls) ───────────────────────────────────

export function formatAmazonPayload(
  event: AtlasEvent,
  mapping: EventMapping,
  identifiers: HashedIdentifier[],
): AmazonConversionEvent {
  const matchKeys: AmazonConversionEvent['matchKeys'] = {};

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':       matchKeys.hashedEmail     = id.value; break;
      case 'phone':       matchKeys.hashedPhone     = id.value; break;
      case 'fn':          matchKeys.hashedFirstName = id.value; break;
      case 'ln':          matchKeys.hashedLastName  = id.value; break;
      case 'ct':          matchKeys.hashedCity      = id.value; break;
      case 'st':          matchKeys.hashedState     = id.value; break;
      case 'zp':          matchKeys.hashedPostal    = id.value; break;
      case 'external_id': matchKeys.externalId      = id.value; break;
    }
  }

  // Address hash: combine street-level address fields into a single hash (if provided)
  // Amazon expects a combined normalised address string hashed as one field
  const addressParts = [event.user_data.city, event.user_data.state, event.user_data.zip].filter(Boolean);
  if (addressParts.length > 0) {
    // Backend delivery will compute the proper combined address hash;
    // here we signal intent by setting the field to the first available part
    void addressParts; // address hash computed server-side in amazonDelivery
  }

  const actionSource = event.action_source === 'app' ? 'mobile_app'
    : event.action_source === 'physical_store' ? 'offline'
    : 'website';

  const payload: AmazonConversionEvent = {
    name: event.event_name,
    eventType: mapping.provider_event ?? event.event_name,
    eventSource: actionSource,
    countryCode: (event.user_data.country ?? 'US').toUpperCase().slice(0, 2),
    timestamp: new Date(event.event_time * 1000).toISOString(),
    clientDedupeId: event.event_id,
    matchKeys,
  };

  if (event.custom_data?.value !== undefined && event.custom_data?.currency) {
    payload.value = {
      currencyCode: event.custom_data.currency.toUpperCase(),
      amount: event.custom_data.value,
    };
  }

  return payload;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class AmazonAdapter implements CAPIProviderAdapter {
  readonly name: CAPIAdapterName = 'amazon';
  readonly provider: CAPIProvider = 'amazon';

  readonly requiredUserParams = ['event_name', 'event_time'];
  readonly optionalUserParams = [
    'email', 'phone', 'first_name', 'last_name', 'city', 'state', 'zip',
    'country', 'external_id', 'maid', 'client_user_agent', 'client_ip_address',
  ];
  readonly dedupStrategy = { key: ['event_name', 'event_id'], window_seconds: 86400 };
  readonly retryPolicy = { max_attempts: 3, backoff: 'exponential' as const, base_ms: 1000 };
  readonly consentSignals = ['marketing'];
  // Amazon has no sandbox endpoint — fire real events with atlas-test- prefix in clientDedupeId
  readonly testMode = { supported: false, credentialField: null as string | null };

  constructor(
    _apiBase: string,
    _getAuthHeader: () => Promise<string>,
  ) {}

  async validateCredentials(creds: ProviderCredentials): Promise<ValidationResult> {
    const amzCreds = creds as AmazonCredentials;
    const missing: string[] = [];
    if (!amzCreds.profile_id)    missing.push('profile_id');
    if (!amzCreds.client_id)     missing.push('client_id');
    if (!amzCreds.client_secret) missing.push('client_secret');
    if (!amzCreds.access_token)  missing.push('access_token');
    if (!amzCreds.refresh_token) missing.push('refresh_token');
    if (missing.length > 0) {
      return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    }
    return { valid: true };
  }

  buildPayload(event: AtlasEvent, _creds: ProviderCredentials, _consent: ConsentDecisions): ProviderPayload {
    const mapping: EventMapping = { atlas_event: event.event_name, provider_event: event.event_name };
    return { provider: 'amazon', raw: formatAmazonPayload(event, mapping, []) };
  }

  validatePayload(payload: ProviderPayload): ValidationResult {
    const ev = payload.raw as AmazonConversionEvent;
    if (!ev.name || !ev.eventType) {
      return { valid: false, error: 'event name and eventType are required' };
    }
    if (Object.keys(ev.matchKeys).length === 0) {
      return { valid: true, details: { warnings: ['No match keys supplied — match quality will be zero'] } };
    }
    return { valid: true };
  }

  async send(_payload: ProviderPayload, _creds: ProviderCredentials): Promise<SendResult> {
    return {
      event_id: (_payload.raw as AmazonConversionEvent).clientDedupeId ?? 'unknown',
      status: 'failed',
      provider_response: null,
      error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED',
      error_message: 'Events must be delivered via the backend pipeline (/api/capi/process)',
    };
  }

  computeMatchQuality(payload: ProviderPayload): number {
    const ev = payload.raw as AmazonConversionEvent;
    const mk = ev.matchKeys;
    let score = 0;
    if (mk.hashedEmail)     score += 4;
    if (mk.hashedPhone)     score += 3;
    if (mk.hashedFirstName && mk.hashedLastName) score += 2;
    else if (mk.hashedFirstName || mk.hashedLastName) score += 1;
    if (mk.hashedAddress)   score += 1;
    if (mk.maid)            score += 2;
    if (mk.externalId)      score += 1;
    return Math.min(10, score);
  }

  // Legacy interface methods

  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[],
  ): ProviderPayload {
    return { provider: 'amazon', raw: formatAmazonPayload(event, mapping, identifiers) };
  }

  async sendEvents(payloads: ProviderPayload[], _creds: ProviderCredentials): Promise<DeliveryResult[]> {
    return payloads.map((p) => ({
      event_id: (p.raw as AmazonConversionEvent).clientDedupeId ?? 'unknown',
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
