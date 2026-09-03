/**
 * Layer L7 — Identity & Match Quality rule tests.
 *
 * Covers each of the 11 crawl-detectable rules' pass/fail/skipped
 * branches. L7.12 (credentials detectable) is out of scope for this
 * phase — not tested here because it isn't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS,
  EMAIL_CAPTURED_FOR_CAPI,
  PHONE_CAPTURED_WHERE_COLLECTED,
  NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED,
  EXTERNAL_ID_SET,
  IDENTITY_NORMALISED_BEFORE_HASHING,
  HASHED_WITH_SHA256,
  HASH_FORMAT_VALID,
  NO_PLAINTEXT_PII_IN_NETWORK_REQUEST,
  NO_PII_IN_URLS_OR_QUERY_STRINGS,
  NO_PII_IN_GA4_EVENT_PARAMETERS,
  L7_RULES,
} from '../L7';
import type { AuditData, DataLayerEvent, NetworkRequest } from '@/types/audit';

const HASHED_EMAIL = 'a'.repeat(64);

function makeEvent(overrides: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { event: 'purchase', timestamp: Date.now(), step: 'confirmation', ...overrides };
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/whatever',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'confirmation',
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'ecommerce',
    declared_platforms: ['google_ads', 'meta', 'tiktok'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L7.1 / L7.2 — Email captured for Enhanced Conversions / CAPI ─────────────

describe('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS (L7.1)', () => {
  it('is skipped when no conversion event was observed', () => {
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when a hashed email is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: HASHED_EMAIL } })] });
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(auditData).status).toBe('pass');
  });

  it('fails when no email is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(auditData).status).toBe('fail');
  });
});

describe('EMAIL_CAPTURED_FOR_CAPI (L7.2)', () => {
  it('passes when a plain email is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: 'user@example.com' } })] });
    expect(EMAIL_CAPTURED_FOR_CAPI.test(auditData).status).toBe('pass');
  });
});

// ── L7.3 — Phone captured where collected ─────────────────────────────────────

describe('PHONE_CAPTURED_WHERE_COLLECTED (L7.3)', () => {
  it('is skipped when phone was never collected anywhere', () => {
    expect(PHONE_CAPTURED_WHERE_COLLECTED.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when phone is present at conversion after being collected earlier', () => {
    const auditData = makeAuditData({
      dataLayer: [
        makeEvent({ event: 'submit_lead_form', step: 'landing', user_data: { phone: '+15551234567' } }),
        makeEvent({ user_data: { phone: '+15551234567' } }),
      ],
    });
    expect(PHONE_CAPTURED_WHERE_COLLECTED.test(auditData).status).toBe('pass');
  });

  it('fails when phone was collected earlier but dropped by conversion', () => {
    const auditData = makeAuditData({
      dataLayer: [
        makeEvent({ event: 'contact_form_blur', step: 'landing', user_data: { phone: '+15551234567' } }),
        makeEvent(),
      ],
    });
    expect(PHONE_CAPTURED_WHERE_COLLECTED.test(auditData).status).toBe('fail');
  });
});

// ── L7.4 — Name and address captured where collected ─────────────────────────

describe('NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED (L7.4)', () => {
  it('is skipped when never collected anywhere', () => {
    expect(NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when present at conversion after being collected earlier', () => {
    const auditData = makeAuditData({
      dataLayer: [
        makeEvent({ step: 'checkout', user_data: { first_name: 'a'.repeat(64) } }),
        makeEvent({ user_data: { first_name: 'a'.repeat(64) } }),
      ],
    });
    expect(NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED.test(auditData).status).toBe('pass');
  });
});

// ── L7.5 — external_id set ────────────────────────────────────────────────────

describe('EXTERNAL_ID_SET (L7.5)', () => {
  it('passes when external_id is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { external_id: 'user-123' } })] });
    expect(EXTERNAL_ID_SET.test(auditData).status).toBe('pass');
  });
  it('fails when absent', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(EXTERNAL_ID_SET.test(auditData).status).toBe('fail');
  });
});

// ── L7.6 — Identity normalised before hashing ─────────────────────────────────

describe('IDENTITY_NORMALISED_BEFORE_HASHING (L7.6)', () => {
  it('is skipped when nothing plaintext is present to check', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: HASHED_EMAIL } })] });
    expect(IDENTITY_NORMALISED_BEFORE_HASHING.test(auditData).status).toBe('skipped');
  });

  it('passes when a plaintext email is already lowercase/trimmed', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: 'user@example.com' } })] });
    expect(IDENTITY_NORMALISED_BEFORE_HASHING.test(auditData).status).toBe('pass');
  });

  it('fails when a plaintext email has mixed case', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: 'User@Example.com' } })] });
    expect(IDENTITY_NORMALISED_BEFORE_HASHING.test(auditData).status).toBe('fail');
  });

  it('fails when a plaintext phone is not E.164', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { phone: '5551234567' } })] });
    expect(IDENTITY_NORMALISED_BEFORE_HASHING.test(auditData).status).toBe('fail');
  });
});

// ── L7.7 — Hashed with SHA-256 ────────────────────────────────────────────────

describe('HASHED_WITH_SHA256 (L7.7)', () => {
  it('is skipped when no email/phone observed', () => {
    expect(HASHED_WITH_SHA256.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when email is a 64-hex hash', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: HASHED_EMAIL } })] });
    expect(HASHED_WITH_SHA256.test(auditData).status).toBe('pass');
  });

  it('fails when email is sent in the clear', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: 'user@example.com' } })] });
    expect(HASHED_WITH_SHA256.test(auditData).status).toBe('fail');
  });
});

// ── L7.8 — Hash format valid ───────────────────────────────────────────────────

describe('HASH_FORMAT_VALID (L7.8)', () => {
  it('is skipped when no hash-shaped value is present', () => {
    expect(HASH_FORMAT_VALID.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes for a well-formed 64-char lowercase hex hash', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: HASHED_EMAIL } })] });
    expect(HASH_FORMAT_VALID.test(auditData).status).toBe('pass');
  });

  it('fails for a malformed hash (wrong length)', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: 'deadbeef' } })] });
    expect(HASH_FORMAT_VALID.test(auditData).status).toBe('fail');
  });

  it('fails for an uppercase hash', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ user_data: { email: HASHED_EMAIL.toUpperCase() } })] });
    expect(HASH_FORMAT_VALID.test(auditData).status).toBe('fail');
  });
});

// ── L7.9 — No plaintext PII in the network request ────────────────────────────

describe('NO_PLAINTEXT_PII_IN_NETWORK_REQUEST (L7.9)', () => {
  it('passes when no request body contains an email', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ body: 'transaction_id=ORDER-1&value=99.99' })] });
    expect(NO_PLAINTEXT_PII_IN_NETWORK_REQUEST.test(auditData).status).toBe('pass');
  });

  it('fails when a request body contains a plaintext email', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ body: 'em=user%40example.com&value=99.99' })] });
    expect(NO_PLAINTEXT_PII_IN_NETWORK_REQUEST.test(auditData).status).toBe('fail');
  });
});

// ── L7.10 — No PII in URLs or query strings ───────────────────────────────────

describe('NO_PII_IN_URLS_OR_QUERY_STRINGS (L7.10)', () => {
  it('passes when no URL contains an email', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://example.com/checkout?order=1' })] });
    expect(NO_PII_IN_URLS_OR_QUERY_STRINGS.test(auditData).status).toBe('pass');
  });

  it('fails when a URL query string contains a plaintext email', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://example.com/checkout?email=user@example.com' })] });
    expect(NO_PII_IN_URLS_OR_QUERY_STRINGS.test(auditData).status).toBe('fail');
  });

  it('fails when the final landing URL contains a plaintext email', () => {
    const auditData = makeAuditData({ landing_final_url: 'https://example.com/?email=user@example.com' });
    expect(NO_PII_IN_URLS_OR_QUERY_STRINGS.test(auditData).status).toBe('fail');
  });
});

// ── L7.11 — No PII in GA4 event parameters ────────────────────────────────────

describe('NO_PII_IN_GA4_EVENT_PARAMETERS (L7.11)', () => {
  it('is skipped when no GA4 hits are observed', () => {
    expect(NO_PII_IN_GA4_EVENT_PARAMETERS.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when GA4 hits carry no plaintext email', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=purchase' })],
    });
    expect(NO_PII_IN_GA4_EVENT_PARAMETERS.test(auditData).status).toBe('pass');
  });

  it('fails when a GA4 hit carries a plaintext email', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&ep.email=user@example.com' })],
    });
    expect(NO_PII_IN_GA4_EVENT_PARAMETERS.test(auditData).status).toBe('fail');
  });
});

describe('L7_RULES', () => {
  it('exports all 11 crawl-detectable L7 rules', () => {
    expect(L7_RULES).toHaveLength(11);
    expect(new Set(L7_RULES.map((r) => r.id)).size).toBe(11);
    expect(new Set(L7_RULES.map((r) => r.rule_id)).size).toBe(11);
  });

  it('excludes L7.12 (credentials detectable)', () => {
    expect(L7_RULES.some((r) => r.id === 'L7.12')).toBe(false);
  });
});
