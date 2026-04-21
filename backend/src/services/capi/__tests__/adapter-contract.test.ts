/**
 * adapter-contract.test.ts
 *
 * Verifies that the backend CAPI delivery services conform to the adapter
 * contract defined in CAPIProviderAdapter:
 *
 *   3.1 – Every required contract field/method is present and typed correctly
 *   3.2 – Meta adapter fixes (event_id auto-gen, DPO, completeness, external_id)
 *
 * These tests run against the pure functions in metaDelivery.ts and
 * checkUserParamCompleteness. Network calls are not made.
 */

import { describe, it, expect } from 'vitest';
import { formatMetaEvent, checkUserParamCompleteness } from '../metaDelivery';
import type { AtlasEvent, EventMapping, HashedIdentifier, MetaCredentials } from '@/types/capi';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BASE_EVENT: AtlasEvent = {
  event_id: 'evt_001',
  event_name: 'purchase',
  event_time: 1700000000,
  event_source_url: 'https://example.com/checkout',
  action_source: 'website',
  user_data: {
    client_ip_address: '203.0.113.1',
    client_user_agent: 'Mozilla/5.0',
  },
  custom_data: { value: 99.99, currency: 'USD', order_id: 'ord_abc' },
  consent_state: { analytics: 'granted', marketing: 'granted', personalisation: 'denied', functional: 'granted' },
};

const MAPPING: EventMapping = { atlas_event: 'purchase', provider_event: 'Purchase' };

const FULL_IDS: HashedIdentifier[] = [
  { type: 'email',       value: 'h_email',    is_hashed: true },
  { type: 'phone',       value: 'h_phone',    is_hashed: true },
  { type: 'fn',          value: 'h_fn',       is_hashed: true },
  { type: 'ln',          value: 'h_ln',       is_hashed: true },
  { type: 'ct',          value: 'h_ct',       is_hashed: true },
  { type: 'st',          value: 'h_st',       is_hashed: true },
  { type: 'zp',          value: 'h_zp',       is_hashed: true },
  { type: 'country',     value: 'h_co',       is_hashed: true },
  { type: 'external_id', value: 'h_extid',    is_hashed: true },
  { type: 'fbc',         value: 'fbc_raw',    is_hashed: false },
  { type: 'fbp',         value: 'fbp_raw',    is_hashed: false },
];

const META_CREDS: MetaCredentials = { pixel_id: 'p123', access_token: 'tok_abc', dataset_id: 'ds123' };

// ── 3.1 Contract field coverage ───────────────────────────────────────────────
// Verify the required fields/functions exist (structural assertion via import).

describe('Meta delivery contract – formatMetaEvent', () => {
  it('is a callable function', () => {
    expect(typeof formatMetaEvent).toBe('function');
  });

  it('returns an object with the required event fields', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, []);
    expect(result).toMatchObject({
      event_name: 'Purchase',
      event_time: 1700000000,
      event_source_url: 'https://example.com/checkout',
      action_source: 'website',
    });
  });

  // 3.2 – event_id auto-generation
  it('preserves event_id when present', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, []);
    expect(result.event_id).toBe('evt_001');
  });

  it('auto-generates a UUID event_id when event_id is empty string', () => {
    const event = { ...BASE_EVENT, event_id: '' };
    const result = formatMetaEvent(event, MAPPING, []);
    expect(result.event_id).toBeTruthy();
    expect(result.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  // 3.2 – identifier mapping
  it('maps all hashed identifiers to user_data fields', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, FULL_IDS);
    expect(result.user_data.em).toEqual(['h_email']);
    expect(result.user_data.ph).toEqual(['h_phone']);
    expect(result.user_data.fn).toEqual(['h_fn']);
    expect(result.user_data.ln).toEqual(['h_ln']);
    expect(result.user_data.ct).toEqual(['h_ct']);
    expect(result.user_data.st).toEqual(['h_st']);
    expect(result.user_data.zp).toEqual(['h_zp']);
    expect(result.user_data.country).toEqual(['h_co']);
    expect(result.user_data.external_id).toEqual(['h_extid']);
    expect(result.user_data.fbc).toBe('fbc_raw');
    expect(result.user_data.fbp).toBe('fbp_raw');
  });

  it('copies client_user_agent and client_ip_address from event.user_data', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, []);
    expect(result.user_data.client_user_agent).toBe('Mozilla/5.0');
    expect(result.user_data.client_ip_address).toBe('203.0.113.1');
  });

  it('maps custom_data fields', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, []);
    expect(result.custom_data?.value).toBe(99.99);
    expect(result.custom_data?.currency).toBe('USD');
    expect(result.custom_data?.order_id).toBe('ord_abc');
  });

  // 3.2 – DPO (Data Processing Options)
  it('omits DPO fields when dpo is undefined', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, []);
    expect(result.data_processing_options).toBeUndefined();
    expect(result.data_processing_options_country).toBeUndefined();
    expect(result.data_processing_options_state).toBeUndefined();
  });

  it('includes DPO fields when dpo has options', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, [], { options: ['LDU'], country: 1, state: 1000 });
    expect(result.data_processing_options).toEqual(['LDU']);
    expect(result.data_processing_options_country).toBe(1);
    expect(result.data_processing_options_state).toBe(1000);
  });

  it('omits DPO fields when dpo.options is empty', () => {
    const result = formatMetaEvent(BASE_EVENT, MAPPING, [], { options: [], country: 0, state: 0 });
    expect(result.data_processing_options).toBeUndefined();
  });
});

// ── 3.1 Contract field coverage – checkUserParamCompleteness ─────────────────

describe('checkUserParamCompleteness', () => {
  it('is a callable function', () => {
    expect(typeof checkUserParamCompleteness).toBe('function');
  });

  it('returns null when >= 6 params are present', () => {
    const ids: HashedIdentifier[] = FULL_IDS.slice(0, 6);
    const result = checkUserParamCompleteness(ids, false, false);
    expect(result).toBeNull();
  });

  it('returns a result when < 6 params are present', () => {
    const ids: HashedIdentifier[] = [
      { type: 'email', value: 'h_email', is_hashed: true },
      { type: 'phone', value: 'h_phone', is_hashed: true },
    ];
    const result = checkUserParamCompleteness(ids, false, false);
    expect(result).not.toBeNull();
    expect(result!.param_count).toBe(2);
    expect(result!.missing_recommended.length).toBeGreaterThan(0);
  });

  it('counts client_user_agent and client_ip_address toward param count', () => {
    const ids: HashedIdentifier[] = [
      { type: 'email',   value: 'h_email', is_hashed: true },
      { type: 'phone',   value: 'h_phone', is_hashed: true },
      { type: 'fn',      value: 'h_fn',    is_hashed: true },
      { type: 'ln',      value: 'h_ln',    is_hashed: true },
    ];
    // 4 ids + user_agent + ip = 6 → should pass
    const result = checkUserParamCompleteness(ids, true, true);
    expect(result).toBeNull();
  });

  it('counts fbc and fbp toward param count', () => {
    const ids: HashedIdentifier[] = [
      { type: 'email',       value: 'h_em',  is_hashed: true },
      { type: 'phone',       value: 'h_ph',  is_hashed: true },
      { type: 'fn',          value: 'h_fn',  is_hashed: true },
      { type: 'ln',          value: 'h_ln',  is_hashed: true },
      { type: 'fbc',         value: 'f_fbc', is_hashed: false },
      { type: 'fbp',         value: 'f_fbp', is_hashed: false },
    ];
    const result = checkUserParamCompleteness(ids, false, false);
    expect(result).toBeNull();
  });
});

// ── 3.1 Meta credentials type shape ──────────────────────────────────────────

describe('MetaCredentials shape', () => {
  it('accepts test_event_code', () => {
    const creds: MetaCredentials = { ...META_CREDS, test_event_code: 'TEST123' };
    expect(creds.test_event_code).toBe('TEST123');
  });

  it('accepts DPO fields', () => {
    const creds: MetaCredentials = {
      ...META_CREDS,
      data_processing_options: ['LDU'],
      data_processing_options_country: 0,
      data_processing_options_state: 0,
    };
    expect(creds.data_processing_options).toEqual(['LDU']);
    expect(creds.data_processing_options_country).toBe(0);
    expect(creds.data_processing_options_state).toBe(0);
  });
});
