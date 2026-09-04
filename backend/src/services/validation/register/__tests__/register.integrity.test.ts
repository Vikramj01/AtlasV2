/**
 * Check Register v2 — whole-REGISTER integrity checks (Task 15 — end-to-end
 * verification of the full crawl-only register).
 *
 * Every layer file (L0-L9, L12) is unit-tested rule-by-rule elsewhere; this
 * file checks properties that only make sense across the WHOLE assembled
 * REGISTER — no duplicate IDs across layers, every rule shaped correctly,
 * and the full applicability + execution pipeline holding together for a
 * realistic AuditData rather than the small hand-built fixtures each
 * layer's own test file uses.
 */
import { describe, it, expect } from 'vitest';
import { REGISTER, runRegister, isRuleApplicable } from '../engine';
import type { AuditData, ValidationLayerV2, Severity, DetectionMethod, DataLayerEvent, NetworkRequest } from '@/types/audit';

const VALID_LAYERS = new Set<ValidationLayerV2>([
  'scope_configuration', 'foundation_tags', 'click_id_capture', 'storage_durability',
  'cross_domain_continuity', 'event_firing', 'parameter_completeness', 'identity_match_quality',
  'consent', 'server_side_delivery', 'deduplication', 'reconciliation', 'hygiene_integrity',
]);
const VALID_SEVERITIES = new Set<Severity>(['critical', 'high', 'medium', 'low']);
const VALID_DETECTION_METHODS = new Set<DetectionMethod>(['crawl', 'second_pass', 'credentials', 'connector']);

describe('REGISTER — structural integrity', () => {
  it('carries exactly 88 rules across the 11 shipped layers (L0-L9, L12)', () => {
    expect(REGISTER).toHaveLength(88);
  });

  it('every rule has a unique register id (L#.#)', () => {
    const ids = REGISTER.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has a unique rule_id', () => {
    const ruleIds = REGISTER.map((r) => r.rule_id);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it('every rule id matches the L#.# format', () => {
    for (const rule of REGISTER) {
      expect(rule.id).toMatch(/^L\d{1,2}\.\d{1,2}$/);
    }
  });

  it('every rule declares a valid layer/severity/detectable_by', () => {
    for (const rule of REGISTER) {
      expect(VALID_LAYERS.has(rule.layer), `${rule.id} has an invalid layer: ${rule.layer}`).toBe(true);
      expect(VALID_SEVERITIES.has(rule.severity), `${rule.id} has an invalid severity: ${rule.severity}`).toBe(true);
      expect(VALID_DETECTION_METHODS.has(rule.detectable_by), `${rule.id} has an invalid detectable_by: ${rule.detectable_by}`).toBe(true);
    }
  });

  it('this phase is crawl-only — every shipped rule is detectable_by crawl', () => {
    const nonCrawl = REGISTER.filter((r) => r.detectable_by !== 'crawl');
    expect(nonCrawl.map((r) => r.id)).toEqual([]);
  });

  it('every rule has a non-empty check description and owner', () => {
    for (const rule of REGISTER) {
      expect(rule.check.length, `${rule.id} has an empty check description`).toBeGreaterThan(0);
      expect(rule.owner.length, `${rule.id} has an empty owner`).toBeGreaterThan(0);
    }
  });

  it('every rule is a function that can be invoked without throwing on a minimal AuditData', () => {
    const minimal: AuditData = {
      audit_id: 'audit-minimal',
      website_url: 'https://example.com',
      funnel_type: 'saas',
      region: 'us',
      dataLayer: [],
      networkRequests: [],
      cookieSnapshots: [],
      localStorageSnapshots: [],
      injected: { gclid: '', fbclid: '' },
    };
    for (const rule of REGISTER) {
      expect(() => rule.test(minimal), `${rule.id} (${rule.rule_id}) threw on a minimal AuditData`).not.toThrow();
    }
  });
});

// ── End-to-end: runRegister against a realistic, fully-populated AuditData ──

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

/** A well-instrumented ecommerce site with Google Ads + Meta declared, primary conversion 'purchase'. */
function makeWellInstrumentedAuditData(): AuditData {
  const hashedEmail = 'a'.repeat(64);
  return {
    audit_id: 'audit-e2e',
    website_url: 'https://shop.example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'ecommerce',
    declared_platforms: ['google_ads', 'meta'],
    primary_channel: 'google_ads',
    traffic_regions: ['us'],
    declared_conversions: [
      { name: 'purchase', kind: 'primary' },
      { name: 'add_to_cart', kind: 'secondary' },
    ],
    steps_visited: ['init', 'landing', 'product', 'checkout', 'confirmation'],
    landing_final_url: 'https://shop.example.com/?gclid=test_gclid_1&fbclid=test_fbclid_1',
    landing_referrer_captured: 'https://www.google.com/',
    urlParams: { gclid: 'test_gclid_1', fbclid: 'test_fbclid_1' },
    cookies: { gclid: 'test_gclid_1', fbclid: 'test_fbclid_1', _gcl_aw: 'GCL.1.abc', _fbp: 'fb.1.1.1', _fbc: 'fb.1.1.2' },
    storage: {},
    sessionStorage: {},
    detailedCookies: [
      { name: '_gcl_aw', value: 'GCL.1.abc', domain: '.shop.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 90 * 86_400, secure: true, sameSite: 'Lax' },
      { name: '_fbc', value: 'fb.1.1.2', domain: '.shop.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 90 * 86_400, secure: true, sameSite: 'Lax' },
    ],
    consoleErrors: [],
    dataLayer: [
      makeEvent({ event: 'page_view', step: 'landing' }),
      makeEvent({ event: 'add_to_cart', step: 'product', value: 20, currency: 'USD' }),
      makeEvent({ event: 'page_view', step: 'product' }),
      makeEvent({ event: 'page_view', step: 'checkout' }),
      makeEvent({
        event: 'purchase',
        step: 'confirmation',
        value: 129.99,
        currency: 'USD',
        transaction_id: 'ORDER-789',
        event_id: 'evt-abc-123',
        items: [{ id: 'sku-1', price: 129.99, quantity: 1 }],
        new_customer: true,
        user_data: { email: hashedEmail, external_id: 'user-42' },
      }),
      makeEvent({ event: 'page_view', step: 'confirmation' }),
    ],
    networkRequests: [
      makeRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123', step: 'landing' }),
      makeRequest({ url: 'https://www.googletagmanager.com/gtag/js?id=AW-123456789', step: 'landing' }),
      makeRequest({ url: 'https://www.facebook.com/tr?id=1&ev=PageView', step: 'landing' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=page_view&cid=1.2', step: 'landing' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=add_to_cart&cid=1.2', step: 'product' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=page_view&cid=1.2', step: 'product' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=page_view&cid=1.2', step: 'checkout' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=purchase&cid=1.2', step: 'confirmation' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=page_view&cid=1.2', step: 'confirmation' }),
      makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion/123', step: 'confirmation' }),
      makeRequest({ url: 'https://www.facebook.com/tr?id=1&ev=Purchase', step: 'confirmation' }),
    ],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: 'test_gclid_1', fbclid: 'test_fbclid_1' },
    pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] },
  };
}

describe('runRegister — end-to-end on a well-instrumented ecommerce site', () => {
  const auditData = makeWellInstrumentedAuditData();
  const results = runRegister(auditData);

  it('runs without throwing and returns one result per applicable rule', () => {
    const applicableCount = REGISTER.filter((r) => isRuleApplicable(r, auditData)).length;
    expect(results).toHaveLength(applicableCount);
  });

  it('excludes rules scoped to undeclared platforms (tiktok, linkedin, microsoft, reddit, pinterest)', () => {
    const tiktokRule = REGISTER.find((r) => r.rule_id === 'TIKTOK_PIXEL_PRESENT');
    expect(tiktokRule).toBeDefined();
    expect(results.some((r) => r.rule_id === 'TIKTOK_PIXEL_PRESENT')).toBe(false);
  });

  it('mostly passes for the platforms/checks this fixture was built to satisfy', () => {
    const byId = new Map(results.map((r) => [r.rule_id, r]));
    expect(byId.get('GTM_CONTAINER_LOADED')?.status).toBe('pass');
    expect(byId.get('GA4_CONFIG_TAG_PRESENT')?.status).toBe('pass');
    expect(byId.get('PRIMARY_CONVERSION_EVENT_FIRES')?.status).toBe('pass');
    expect(byId.get('GOOGLE_ADS_CONVERSION_EVENT_FIRES')?.status).toBe('pass');
    expect(byId.get('CONVERSION_VALUE_PRESENT')?.status).toBe('pass');
    expect(byId.get('TRANSACTION_ID_PRESENT')?.status).toBe('pass');
    expect(byId.get('GCL_AW_COOKIE_PRESENT')?.status).toBe('pass');
  });

  it('never produces a fail/warning result whose evidence indicates an unhandled exception', () => {
    const thrown = results.filter((r) => r.technical_details.evidence.some((e) => e.startsWith('Error:')));
    expect(thrown.map((r) => r.rule_id)).toEqual([]);
  });

  it('produces only valid RuleStatus values', () => {
    const validStatuses = new Set(['pass', 'fail', 'warning', 'skipped', 'not_run']);
    expect(results.every((r) => validStatuses.has(r.status))).toBe(true);
  });
});

describe('runRegister — end-to-end on a bare, untracked AuditData', () => {
  // Not every check is "did something good happen" — several are "did
  // something bad NOT happen" (no PII leaked, no duplicate tag, no console
  // errors), which legitimately passes vacuously on empty data. So this
  // doesn't assert zero passes overall — it asserts that the checks whose
  // whole point is positive evidence of an actual implementation correctly
  // do NOT pass when nothing was ever observed.
  it('runs without throwing, and positive-evidence checks fail or skip rather than falsely passing', () => {
    const bare: AuditData = {
      audit_id: 'audit-bare',
      website_url: 'https://example.com',
      funnel_type: 'saas',
      region: 'us',
      rule_set_version: 'v2',
      site_type: 'plg_saas',
      declared_platforms: ['google_ads'],
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      steps_visited: ['init', 'landing'],
      dataLayer: [],
      networkRequests: [],
      cookieSnapshots: [],
      localStorageSnapshots: [],
      injected: { gclid: '', fbclid: '' },
    };
    const results = runRegister(bare);
    const byId = new Map(results.map((r) => [r.rule_id, r]));

    const positiveEvidenceRuleIds = [
      'GTM_CONTAINER_LOADED',
      'DECLARED_PLATFORM_HAS_TAG',
      'CONVERSION_SURFACE_IDENTIFIED',
      'DATALAYER_INITIALISED',
      'GA4_CONFIG_TAG_PRESENT',
      'GOOGLE_GLOBAL_SITE_TAG_PRESENT',
      'CONVERSION_LINKER_ENABLED',
      'GCLID_CAPTURED_AT_LANDING',
      'GCL_AW_COOKIE_PRESENT',
      'PRIMARY_CONVERSION_EVENT_FIRES',
      'GOOGLE_ADS_CONVERSION_EVENT_FIRES',
      'GA4_CONVERSION_EVENT_FIRES',
      'CONVERSION_VALUE_PRESENT',
      'TRANSACTION_ID_PRESENT',
      'EVENT_ID_PRESENT',
      'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
    ];

    for (const ruleId of positiveEvidenceRuleIds) {
      const result = byId.get(ruleId);
      expect(result, `expected ${ruleId} to be in the register's results`).toBeDefined();
      expect(result?.status, `expected ${ruleId} not to pass on a bare AuditData`).not.toBe('pass');
    }
  });
});
