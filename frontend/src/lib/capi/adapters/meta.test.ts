/**
 * meta-adapter.test.ts
 *
 * Tests for the Meta Conversions API adapter:
 *   - formatMetaPayload: pure function that shapes identifiers into Meta's user_data schema
 *   - estimateEMQ: scoring function for event match quality
 */

import { describe, it, expect } from 'vitest';
import { formatMetaPayload, estimateEMQ } from './meta';
import type { AtlasEvent, EventMapping, HashedIdentifier } from '@/types/capi';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_EVENT: AtlasEvent = {
  event_id: 'evt_test_001',
  event_name: 'purchase',
  event_time: 1700000000,
  event_source_url: 'https://example.com/checkout',
  action_source: 'website',
  user_data: {
    client_ip_address: '203.0.113.1',
    client_user_agent: 'Mozilla/5.0',
  },
  custom_data: {
    value: 99.99,
    currency: 'USD',
    order_id: 'order_abc123',
    content_type: 'product',
    content_ids: ['sku_001'],
    num_items: 1,
  },
  consent_state: { analytics: true, marketing: true },
};

const MAPPING: EventMapping = {
  atlas_event: 'purchase',
  provider_event: 'Purchase',
  enabled: true,
};

const HASHED_IDS: HashedIdentifier[] = [
  { type: 'email',       value: 'hashed_email_value',    is_hashed: true },
  { type: 'phone',       value: 'hashed_phone_value',    is_hashed: true },
  { type: 'fn',          value: 'hashed_fn_value',       is_hashed: true },
  { type: 'ln',          value: 'hashed_ln_value',       is_hashed: true },
  { type: 'ct',          value: 'hashed_ct_value',       is_hashed: true },
  { type: 'st',          value: 'hashed_st_value',       is_hashed: true },
  { type: 'zp',          value: 'hashed_zp_value',       is_hashed: true },
  { type: 'country',     value: 'hashed_country_value',  is_hashed: true },
  { type: 'external_id', value: 'hashed_extid_value',    is_hashed: true },
  { type: 'fbc',         value: 'fb.1.1111.abcdef',      is_hashed: false },
  { type: 'fbp',         value: 'fb.1.2222.ghijkl',      is_hashed: false },
];

// ── formatMetaPayload ─────────────────────────────────────────────────────────

describe('formatMetaPayload', () => {
  it('maps event_name from the EventMapping provider_event', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.event_name).toBe('Purchase');
  });

  it('preserves event_id, event_time, event_source_url, action_source', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.event_id).toBe('evt_test_001');
    expect(result.event_time).toBe(1700000000);
    expect(result.event_source_url).toBe('https://example.com/checkout');
    expect(result.action_source).toBe('website');
  });

  it('maps email identifiers to user_data.em array', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.em).toEqual(['hashed_email_value']);
  });

  it('maps phone identifiers to user_data.ph array', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.ph).toEqual(['hashed_phone_value']);
  });

  it('maps first/last name to fn and ln arrays', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.fn).toEqual(['hashed_fn_value']);
    expect(result.user_data.ln).toEqual(['hashed_ln_value']);
  });

  it('maps address fields (ct, st, zp, country)', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.ct).toEqual(['hashed_ct_value']);
    expect(result.user_data.st).toEqual(['hashed_st_value']);
    expect(result.user_data.zp).toEqual(['hashed_zp_value']);
    expect(result.user_data.country).toEqual(['hashed_country_value']);
  });

  it('maps external_id to user_data.external_id array', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.external_id).toEqual(['hashed_extid_value']);
  });

  it('maps fbc and fbp as scalar strings (not arrays)', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.fbc).toBe('fb.1.1111.abcdef');
    expect(result.user_data.fbp).toBe('fb.1.2222.ghijkl');
  });

  it('includes client_user_agent and client_ip_address from user_data', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.user_data.client_user_agent).toBe('Mozilla/5.0');
    expect(result.user_data.client_ip_address).toBe('203.0.113.1');
  });

  it('includes custom_data when present on the event', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, HASHED_IDS);
    expect(result.custom_data).toBeDefined();
    expect(result.custom_data?.value).toBe(99.99);
    expect(result.custom_data?.currency).toBe('USD');
    expect(result.custom_data?.order_id).toBe('order_abc123');
  });

  it('omits custom_data when not present on the event', () => {
    const eventNoCustom: AtlasEvent = { ...BASE_EVENT, custom_data: undefined };
    const result = formatMetaPayload(eventNoCustom, MAPPING, []);
    expect(result.custom_data).toBeUndefined();
  });

  it('produces empty user_data object when no identifiers supplied', () => {
    const result = formatMetaPayload(BASE_EVENT, MAPPING, []);
    // Only client-level fields (ip, ua) should be present — no hashed PII
    expect(result.user_data.em).toBeUndefined();
    expect(result.user_data.ph).toBeUndefined();
    expect(result.user_data.client_user_agent).toBe('Mozilla/5.0');
  });
});

// ── estimateEMQ ───────────────────────────────────────────────────────────────

describe('estimateEMQ', () => {
  it('returns 0 with no identifiers', () => {
    expect(estimateEMQ([])).toBe(0);
  });

  it('adds 3 points for email', () => {
    const ids: HashedIdentifier[] = [
      { type: 'email', value: 'h', is_hashed: true },
    ];
    expect(estimateEMQ(ids)).toBe(3);
  });

  it('adds 2 points for phone', () => {
    const ids: HashedIdentifier[] = [
      { type: 'phone', value: 'h', is_hashed: true },
    ];
    expect(estimateEMQ(ids)).toBe(2);
  });

  it('adds 2 points for fbc click ID', () => {
    const ids: HashedIdentifier[] = [
      { type: 'fbc', value: 'raw', is_hashed: false },
    ];
    expect(estimateEMQ(ids)).toBe(2);
  });

  it('adds 1 point for fbp click ID', () => {
    const ids: HashedIdentifier[] = [
      { type: 'fbp', value: 'raw', is_hashed: false },
    ];
    expect(estimateEMQ(ids)).toBe(1);
  });

  it('adds 1 point for fn+ln combined (not individually)', () => {
    const withBoth: HashedIdentifier[] = [
      { type: 'fn', value: 'h', is_hashed: true },
      { type: 'ln', value: 'h', is_hashed: true },
    ];
    const withOnlyFn: HashedIdentifier[] = [
      { type: 'fn', value: 'h', is_hashed: true },
    ];
    expect(estimateEMQ(withBoth)).toBe(1);
    expect(estimateEMQ(withOnlyFn)).toBe(0); // no ln → no point
  });

  it('adds 1 point for external_id', () => {
    const ids: HashedIdentifier[] = [
      { type: 'external_id', value: 'h', is_hashed: true },
    ];
    expect(estimateEMQ(ids)).toBe(1);
  });

  it('caps at 10 for a fully-populated event', () => {
    const ids: HashedIdentifier[] = [
      { type: 'email',       value: 'h', is_hashed: true },  // +3
      { type: 'phone',       value: 'h', is_hashed: true },  // +2
      { type: 'fbc',         value: 'r', is_hashed: false }, // +2
      { type: 'fbp',         value: 'r', is_hashed: false }, // +1
      { type: 'fn',          value: 'h', is_hashed: true },  // +1 (with ln)
      { type: 'ln',          value: 'h', is_hashed: true },
      { type: 'external_id', value: 'h', is_hashed: true },  // +1
    ];
    expect(estimateEMQ(ids)).toBe(10);
  });

  it('does not count unhashed PII (e.g. gclid) toward score', () => {
    const ids: HashedIdentifier[] = [
      { type: 'gclid', value: 'raw_gclid', is_hashed: false },
    ];
    expect(estimateEMQ(ids)).toBe(0);
  });
});
