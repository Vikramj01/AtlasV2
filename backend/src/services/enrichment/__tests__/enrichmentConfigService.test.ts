/**
 * EnrichmentConfigService unit tests
 *
 * Covers:
 *   1. resolveFieldPath — dotted path resolution, edge cases
 *   2. validateFieldPathSyntax — allows/rejects various inputs
 *   3. applyIdentityConfig — maps identity fields from raw event data
 *   4. applySignalEnrichment — maps value, currency, dedup, content IDs
 *   5. validateSignalEnrichment — scoring and warning generation
 *   6. computeClientEnrichmentScore — composite score calculation
 */

import { describe, it, expect } from 'vitest';
import {
  resolveFieldPath,
  validateFieldPathSyntax,
  applyIdentityConfig,
  applySignalEnrichment,
  validateSignalEnrichment,
  computeClientEnrichmentScore,
} from '../enrichmentConfigService';
import type { ClientIdentityConfig, SignalEnrichmentConfig } from '@/types/enrichment';
import type { AtlasEvent } from '@/types/capi';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseAtlasEvent = (): AtlasEvent => ({
  event_id: 'evt-001',
  event_name: 'purchase',
  event_time: Date.now(),
  user_data: {},
  custom_data: {},
  consent_state: { marketing: 'granted', analytics: 'granted' },
  action_source: 'website',
});

const baseIdentityConfig = (): ClientIdentityConfig => ({
  id: 'id-001',
  client_id: 'client-001',
  email_field: 'customer.email',
  phone_field: 'customer.phone',
  first_name_field: 'customer.firstName',
  last_name_field: 'customer.lastName',
  postal_code_field: 'customer.zip',
  country_field: 'customer.country',
  external_id_field: 'customer.id',
  fbc_field: '_fbc',
  fbp_field: '_fbp',
  gclid_field: 'gclid',
  wbraid_field: 'wbraid',
  gbraid_field: 'gbraid',
  auto_capture_ip: true,
  auto_capture_ua: true,
  enabled_identifiers: ['email', 'phone', 'fn', 'ln', 'zp', 'country', 'external_id', 'fbc', 'fbp', 'gclid'],
  validated_at: null,
  identity_score: null,
  created_at: '2026-07-03T00:00:00Z',
  updated_at: '2026-07-03T00:00:00Z',
});

const baseSignalEnrichmentConfig = (): SignalEnrichmentConfig => ({
  id: 'sec-001',
  deployment_id: 'dep-001',
  signal_key: 'purchase',
  event_source: 'website',
  value_config: { field: 'ecommerce.purchase.actionField.revenue', includes_tax: false, includes_shipping: false },
  currency_config: { mode: 'static', static_value: 'GBP' },
  dedup_config: { field: 'ecommerce.purchase.actionField.id' },
  content_config: { ids_field: 'ecommerce.purchase.products', ids_path_type: 'array' },
  enabled_for_meta: true,
  enabled_for_google: true,
  validated_at: null,
  validation_score: null,
  validation_warnings: [],
  created_at: '2026-07-03T00:00:00Z',
  updated_at: '2026-07-03T00:00:00Z',
});

// ─── resolveFieldPath ─────────────────────────────────────────────────────────

describe('resolveFieldPath', () => {
  it('resolves a simple top-level key', () => {
    expect(resolveFieldPath({ email: 'a@b.com' }, 'email')).toBe('a@b.com');
  });

  it('resolves a deeply nested dotted path', () => {
    const obj = { ecommerce: { purchase: { actionField: { revenue: 149.99 } } } };
    expect(resolveFieldPath(obj, 'ecommerce.purchase.actionField.revenue')).toBe(149.99);
  });

  it('returns undefined for a missing key', () => {
    expect(resolveFieldPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for a path that traverses a non-object', () => {
    expect(resolveFieldPath({ a: 'string' }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(resolveFieldPath({ a: 1 }, '')).toBeUndefined();
  });

  it('returns undefined for "auto" path', () => {
    expect(resolveFieldPath({ auto: 'yes' }, 'auto')).toBeUndefined();
  });

  it('handles numeric string values', () => {
    expect(resolveFieldPath({ price: '99.99' }, 'price')).toBe('99.99');
  });
});

// ─── validateFieldPathSyntax ──────────────────────────────────────────────────

describe('validateFieldPathSyntax', () => {
  it('accepts valid dot-notation paths', () => {
    expect(validateFieldPathSyntax('ecommerce.purchase.actionField.revenue')).toBe(true);
    expect(validateFieldPathSyntax('customer.email')).toBe(true);
    expect(validateFieldPathSyntax('_fbc')).toBe(true);
    expect(validateFieldPathSyntax('items[0].id')).toBe(true);
  });

  it('rejects paths with spaces', () => {
    expect(validateFieldPathSyntax('customer email')).toBe(false);
  });

  it('rejects paths with special characters', () => {
    expect(validateFieldPathSyntax('customer.email; DROP TABLE')).toBe(false);
    expect(validateFieldPathSyntax('field$name')).toBe(false);
  });
});

// ─── applyIdentityConfig ──────────────────────────────────────────────────────

describe('applyIdentityConfig', () => {
  const rawData = {
    customer: {
      email: 'alice@example.com',
      phone: '+447700000000',
      firstName: 'Alice',
      lastName: 'Smith',
      zip: 'SW1A 1AA',
      country: 'GB',
      id: 'cust-999',
    },
    _fbc: 'fb.1.1234.abcdef',
    _fbp: 'fb.1.5678.xyz',
    gclid: 'Cj0KCQ',
  };

  it('populates all enabled identity fields', () => {
    const result = applyIdentityConfig(baseAtlasEvent(), rawData, baseIdentityConfig());
    expect(result.user_data.email).toBe('alice@example.com');
    expect(result.user_data.phone).toBe('+447700000000');
    expect(result.user_data.first_name).toBe('Alice');
    expect(result.user_data.last_name).toBe('Smith');
    expect(result.user_data.zip).toBe('SW1A 1AA');
    expect(result.user_data.country).toBe('GB');
    expect(result.user_data.external_id).toBe('cust-999');
  });

  it('resolves click IDs from flat raw data', () => {
    const result = applyIdentityConfig(baseAtlasEvent(), rawData, baseIdentityConfig());
    expect(result.user_data.fbc).toBe('fb.1.1234.abcdef');
    expect(result.user_data.fbp).toBe('fb.1.5678.xyz');
    expect(result.user_data.gclid).toBe('Cj0KCQ');
  });

  it('auto-captures IP and UA from request context', () => {
    const result = applyIdentityConfig(
      baseAtlasEvent(),
      rawData,
      baseIdentityConfig(),
      '1.2.3.4',
      'Mozilla/5.0',
    );
    expect(result.user_data.client_ip_address).toBe('1.2.3.4');
    expect(result.user_data.client_user_agent).toBe('Mozilla/5.0');
  });

  it('skips disabled identifiers', () => {
    const config = baseIdentityConfig();
    config.enabled_identifiers = ['email'];
    const result = applyIdentityConfig(baseAtlasEvent(), rawData, config);
    expect(result.user_data.email).toBe('alice@example.com');
    expect(result.user_data.phone).toBeUndefined();
    expect(result.user_data.fbc).toBeUndefined();
  });

  it('skips fields with no configured path', () => {
    const config = baseIdentityConfig();
    config.email_field = null;
    const result = applyIdentityConfig(baseAtlasEvent(), rawData, config);
    expect(result.user_data.email).toBeUndefined();
  });

  it('does not override existing user_data fields if raw value missing', () => {
    const event = baseAtlasEvent();
    event.user_data.email = 'existing@example.com';
    const result = applyIdentityConfig(event, {}, baseIdentityConfig());
    expect(result.user_data.email).toBe('existing@example.com');
  });
});

// ─── applySignalEnrichment ────────────────────────────────────────────────────

describe('applySignalEnrichment', () => {
  const rawData = {
    ecommerce: {
      purchase: {
        actionField: { revenue: 149.99, id: 'ORD-123' },
        products: ['prod-1', 'prod-2', 'prod-3'],
      },
      currencyCode: 'USD',
    },
  };

  it('resolves value, dedup ID, and static currency', () => {
    const result = applySignalEnrichment(baseAtlasEvent(), rawData, baseSignalEnrichmentConfig());
    expect(result.custom_data.value).toBe(149.99);
    expect(result.custom_data.order_id).toBe('ORD-123');
    expect(result.custom_data.currency).toBe('GBP');
  });

  it('resolves dynamic currency from dataLayer', () => {
    const config = baseSignalEnrichmentConfig();
    config.currency_config = { mode: 'dynamic', field: 'ecommerce.currencyCode' };
    const result = applySignalEnrichment(baseAtlasEvent(), rawData, config);
    expect(result.custom_data.currency).toBe('USD');
  });

  it('resolves content IDs from an array field', () => {
    const result = applySignalEnrichment(baseAtlasEvent(), rawData, baseSignalEnrichmentConfig());
    expect(result.custom_data.content_ids).toEqual(['prod-1', 'prod-2', 'prod-3']);
    expect(result.custom_data.num_items).toBe(3);
  });

  it('coerces string value to number', () => {
    const config = baseSignalEnrichmentConfig();
    config.value_config = { field: 'price', includes_tax: false, includes_shipping: false };
    const result = applySignalEnrichment(baseAtlasEvent(), { price: '299.00' }, config);
    expect(result.custom_data.value).toBe(299);
  });

  it('skips value when field missing from raw data', () => {
    const result = applySignalEnrichment(baseAtlasEvent(), {}, baseSignalEnrichmentConfig());
    expect(result.custom_data.value).toBeUndefined();
    expect(result.custom_data.order_id).toBeUndefined();
  });

  it('does not modify event when no configs set', () => {
    const config = baseSignalEnrichmentConfig();
    config.value_config = null;
    config.currency_config = null;
    config.dedup_config = null;
    config.content_config = null;
    const original = baseAtlasEvent();
    const result = applySignalEnrichment(original, rawData, config);
    expect(result.custom_data).toEqual({});
  });
});

// ─── validateSignalEnrichment ─────────────────────────────────────────────────

describe('validateSignalEnrichment', () => {
  it('returns score 65 when only content_ids missing', () => {
    const config = baseSignalEnrichmentConfig();
    config.content_config = null;
    const result = validateSignalEnrichment(config);
    expect(result.score).toBe(90);
    expect(result.recommended_missing).toContain('content_ids_field');
  });

  it('returns score 0 when all required fields missing', () => {
    const config = baseSignalEnrichmentConfig();
    config.value_config = null;
    config.currency_config = null;
    config.dedup_config = null;
    config.content_config = null;
    const result = validateSignalEnrichment(config);
    // 3 required × -25 = -75, 1 recommended × -10 = -10, total = 15
    expect(result.score).toBe(15);
    expect(result.required_missing).toContain('value_field');
    expect(result.required_missing).toContain('dedup_id_field');
    expect(result.required_missing).toContain('currency');
  });

  it('returns score 100 when fully configured with content IDs', () => {
    const result = validateSignalEnrichment(baseSignalEnrichmentConfig());
    expect(result.score).toBe(100);
    expect(result.warnings).toHaveLength(0);
  });

  it('adds info warning when value includes tax', () => {
    const config = baseSignalEnrichmentConfig();
    config.value_config = { field: 'total', includes_tax: true, includes_shipping: false };
    const result = validateSignalEnrichment(config);
    const taxWarning = result.warnings.find(w => w.field === 'value_field' && w.severity === 'info');
    expect(taxWarning).toBeDefined();
  });
});

// ─── computeClientEnrichmentScore ────────────────────────────────────────────

describe('computeClientEnrichmentScore', () => {
  it('returns zero scores when no identity config or enrichments', () => {
    const result = computeClientEnrichmentScore(null, []);
    expect(result.overall).toBe(0);
    expect(result.identity_score).toBe(0);
    expect(result.signal_scores).toHaveLength(0);
  });

  it('computes identity score correctly for full config', () => {
    const config = baseIdentityConfig();
    const result = computeClientEnrichmentScore(config, []);
    // email(35) + phone(20) + fbc(15) + fbp(10) + gclid(10) + ip(5) + ua(5) = 100
    expect(result.identity_score).toBe(100);
    expect(result.estimated_meta_emq).toBe(8);
    expect(result.estimated_google_match_rate).toBe(65);
  });

  it('computes overall as 50/50 average of identity and signal scores', () => {
    const config = baseIdentityConfig();
    const enrichment = baseSignalEnrichmentConfig();
    enrichment.validation_score = 80;
    const result = computeClientEnrichmentScore(config, [enrichment]);
    // identity=100, signal avg=80 → overall = round(50 + 40) = 90
    expect(result.overall).toBe(90);
  });

  it('returns low EMQ and match rate for empty identity config', () => {
    const config = baseIdentityConfig();
    config.enabled_identifiers = [];
    const result = computeClientEnrichmentScore(config, []);
    expect(result.estimated_meta_emq).toBe(2);
    expect(result.estimated_google_match_rate).toBe(20);
  });
});
