/**
 * google-adapter.test.ts
 *
 * Tests for the Google Enhanced Conversions adapter:
 *   - formatGooglePayload: builds a GoogleConversionAdjustment from an AtlasEvent
 */

import { describe, it, expect } from 'vitest';
import { formatGooglePayload } from './google';
import type { AtlasEvent, EventMapping, HashedIdentifier, GoogleCredentials } from '@/types/capi';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CREDS: GoogleCredentials = {
  customer_id: '123-456-7890',
  oauth_access_token: 'token_abc',
  oauth_refresh_token: 'refresh_abc',
  conversion_action_id: '9999',
};

const BASE_EVENT: AtlasEvent = {
  event_id: 'evt_google_001',
  event_name: 'purchase',
  event_time: 1700000000,
  event_source_url: 'https://example.com/checkout',
  action_source: 'website',
  user_data: {
    client_user_agent: 'Mozilla/5.0',
    gclid: 'TeSter_gclid_abc123',
  },
  custom_data: {
    value: 49.99,
    currency: 'USD',
    order_id: 'order_xyz',
    content_type: undefined,
    content_ids: undefined,
    num_items: undefined,
  },
  consent_state: { analytics: true, marketing: true },
};

const MAPPING: EventMapping = {
  atlas_event: 'purchase',
  provider_event: 'PURCHASE',
  enabled: true,
};

const HASHED_IDS: HashedIdentifier[] = [
  { type: 'email', value: 'hashed_email',  is_hashed: true },
  { type: 'phone', value: 'hashed_phone',  is_hashed: true },
  { type: 'fn',    value: 'hashed_fn',     is_hashed: true },
  { type: 'ln',    value: 'hashed_ln',     is_hashed: true },
  { type: 'ct',    value: 'hashed_ct',     is_hashed: true },
  { type: 'st',    value: 'hashed_st',     is_hashed: true },
  { type: 'zp',    value: 'hashed_zp',     is_hashed: true },
  { type: 'country', value: 'hashed_co',   is_hashed: true },
];

// ── formatGooglePayload ───────────────────────────────────────────────────────

describe('formatGooglePayload', () => {
  it('sets adjustmentType to ENHANCEMENT', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    expect(result.adjustmentType).toBe('ENHANCEMENT');
  });

  it('constructs conversionAction path from customer_id and conversion_action_id', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    // Dashes stripped from customer_id: 123-456-7890 → 1234567890
    expect(result.conversionAction).toBe('customers/1234567890/conversionActions/9999');
  });

  it('strips dashes from customer_id in conversionAction path', () => {
    const credsWithDashes: GoogleCredentials = { ...CREDS, customer_id: '111-222-3333' };
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], credsWithDashes);
    expect(result.conversionAction).toContain('customers/1112223333/');
  });

  it('maps email identifier to hashedEmail in userIdentifiers', () => {
    const ids: HashedIdentifier[] = [{ type: 'email', value: 'hashed_email', is_hashed: true }];
    const result = formatGooglePayload(BASE_EVENT, MAPPING, ids, CREDS);
    expect(result.userIdentifiers).toContainEqual({ hashedEmail: 'hashed_email' });
  });

  it('maps phone identifier to hashedPhoneNumber in userIdentifiers', () => {
    const ids: HashedIdentifier[] = [{ type: 'phone', value: 'hashed_phone', is_hashed: true }];
    const result = formatGooglePayload(BASE_EVENT, MAPPING, ids, CREDS);
    expect(result.userIdentifiers).toContainEqual({ hashedPhoneNumber: 'hashed_phone' });
  });

  it('groups address fields (fn, ln, ct, st, zp, country) into a single addressInfo entry', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, HASHED_IDS, CREDS);
    const addressEntry = result.userIdentifiers.find(id => 'addressInfo' in id);
    expect(addressEntry).toBeDefined();
    const info = (addressEntry as { addressInfo: Record<string, string> }).addressInfo;
    expect(info.hashedFirstName).toBe('hashed_fn');
    expect(info.hashedLastName).toBe('hashed_ln');
    expect(info.city).toBe('hashed_ct');
    expect(info.state).toBe('hashed_st');
    expect(info.postalCode).toBe('hashed_zp');
    expect(info.countryCode).toBe('hashed_co');
  });

  it('omits addressInfo when no address fields are present', () => {
    const emailOnly: HashedIdentifier[] = [{ type: 'email', value: 'h', is_hashed: true }];
    const result = formatGooglePayload(BASE_EVENT, MAPPING, emailOnly, CREDS);
    const addressEntry = result.userIdentifiers.find(id => 'addressInfo' in id);
    expect(addressEntry).toBeUndefined();
  });

  it('sets gclidDateTimePair when gclid is present in user_data', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    expect(result.gclidDateTimePair).toBeDefined();
    expect(result.gclidDateTimePair?.gclid).toBe('TeSter_gclid_abc123');
    // conversionDateTime must be ISO format with timezone offset
    expect(result.gclidDateTimePair?.conversionDateTime).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00:00/);
  });

  it('omits gclidDateTimePair when gclid is absent', () => {
    const eventNoGclid: AtlasEvent = {
      ...BASE_EVENT,
      user_data: { client_user_agent: 'Mozilla/5.0' },
    };
    const result = formatGooglePayload(eventNoGclid, MAPPING, [], CREDS);
    expect(result.gclidDateTimePair).toBeUndefined();
  });

  it('sets orderId from custom_data.order_id', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    expect(result.orderId).toBe('order_xyz');
  });

  it('omits orderId when custom_data is absent', () => {
    const eventNoCustom: AtlasEvent = { ...BASE_EVENT, custom_data: undefined };
    const result = formatGooglePayload(eventNoCustom, MAPPING, [], CREDS);
    expect(result.orderId).toBeUndefined();
  });

  it('sets userAgent from user_data.client_user_agent', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    expect(result.userAgent).toBe('Mozilla/5.0');
  });

  it('produces an empty userIdentifiers array when no identifiers supplied', () => {
    const result = formatGooglePayload(BASE_EVENT, MAPPING, [], CREDS);
    expect(result.userIdentifiers).toHaveLength(0);
  });
});
