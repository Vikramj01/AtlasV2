/**
 * Layer L0 — Scope & Configuration rule tests.
 *
 * Covers each of the 4 rules' pass/fail/skipped/warning branches.
 */
import { describe, it, expect } from 'vitest';
import {
  DECLARED_PLATFORM_HAS_TAG,
  UNDECLARED_PLATFORM_TAG_DETECTED,
  CONVERSION_SURFACE_IDENTIFIED,
  PRODUCT_DOMAIN_REACHABLE,
  L0_RULES,
} from '../L0';
import type { AuditData, NetworkRequest } from '@/types/audit';

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/whatever',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'landing',
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
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L0.1 — Declared platform has a tag present ──────────────────────────────

describe('DECLARED_PLATFORM_HAS_TAG (L0.1)', () => {
  it('passes when every declared platform has a tag present', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      networkRequests: [
        makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' }),
        makeRequest({ url: 'https://www.facebook.com/tr?id=123' }),
      ],
    });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.rule_id).toBe('DECLARED_PLATFORM_HAS_TAG');
  });

  it('fails when a declared platform has no tag detected', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      networkRequests: [makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' })],
    });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.some((e) => e.includes('Meta') && e.includes('NO TAG'))).toBe(true);
  });

  it('is skipped when no platforms are declared', () => {
    const result = DECLARED_PLATFORM_HAS_TAG.test(makeAuditData({ declared_platforms: [] }));
    expect(result.status).toBe('skipped');
  });
});

// ── L0.2 — Undeclared platform tag detected ─────────────────────────────────

describe('UNDECLARED_PLATFORM_TAG_DETECTED (L0.2)', () => {
  it('passes when no undeclared platform tags are found', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      networkRequests: [makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' })],
    });
    const result = UNDECLARED_PLATFORM_TAG_DETECTED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('warns when an undeclared platform tag is detected', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      networkRequests: [
        makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion' }),
        makeRequest({ url: 'https://analytics.tiktok.com/i18n/pixel/events.js' }),
      ],
    });
    const result = UNDECLARED_PLATFORM_TAG_DETECTED.test(auditData);
    expect(result.status).toBe('warning');
    expect(result.technical_details.found).toContain('TikTok');
  });
});

// ── L0.3 — Conversion surface identified ────────────────────────────────────

describe('CONVERSION_SURFACE_IDENTIFIED (L0.3)', () => {
  it('passes when a non-landing dataLayer step was reached', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'purchase', timestamp: Date.now(), step: 'conversion' }],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('passes when a non-landing network request step was reached', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ step: 'checkout' })],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('pass');
  });

  it('fails when the crawl never progressed past landing/init', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }],
      networkRequests: [makeRequest({ step: 'init' })],
    });
    const result = CONVERSION_SURFACE_IDENTIFIED.test(auditData);
    expect(result.status).toBe('fail');
  });
});

// ── L0.4 — Product domain reachable ─────────────────────────────────────────

describe('PRODUCT_DOMAIN_REACHABLE (L0.4)', () => {
  it('is skipped when product_domain_reachable was never resolved', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(makeAuditData({ product_domain_reachable: undefined }));
    expect(result.status).toBe('skipped');
  });

  it('passes when the product domain was reachable', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(
      makeAuditData({ product_domain: 'https://app.example.com', product_domain_reachable: true }),
    );
    expect(result.status).toBe('pass');
  });

  it('fails when the product domain was not reachable', () => {
    const result = PRODUCT_DOMAIN_REACHABLE.test(
      makeAuditData({ product_domain: 'https://app.example.com', product_domain_reachable: false }),
    );
    expect(result.status).toBe('fail');
  });
});

describe('L0_RULES', () => {
  it('exports all 4 L0 rules', () => {
    expect(L0_RULES).toHaveLength(4);
    expect(L0_RULES.map((r) => r.id)).toEqual(['L0.1', 'L0.2', 'L0.3', 'L0.4']);
  });
});
