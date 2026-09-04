/**
 * Layer L4 — Cross-Domain Continuity rule tests.
 *
 * Covers each of the 4 crawl-detectable rules' pass/fail/skipped branches.
 * L4.5-9 (connector/credentials/second-pass detectable) are out of scope
 * for this phase — not tested here because they aren't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  CROSS_DOMAIN_LINKER_CONFIGURED,
  GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS,
  GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY,
  SESSION_NOT_RESTARTED_AT_BOUNDARY,
  L4_RULES,
} from '../L4';
import type { AuditData } from '@/types/audit';

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

// ── L4.1 — Cross-domain linker configured ────────────────────────────────────

describe('CROSS_DOMAIN_LINKER_CONFIGURED (L4.1)', () => {
  it('is skipped when no outbound cross-domain links were found', () => {
    expect(CROSS_DOMAIN_LINKER_CONFIGURED.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when at least one outbound link carries _gl', () => {
    const auditData = makeAuditData({ outboundCrossDomainLinks: { total: 3, withGl: 1 } });
    expect(CROSS_DOMAIN_LINKER_CONFIGURED.test(auditData).status).toBe('pass');
  });

  it('fails when no outbound link carries _gl', () => {
    const auditData = makeAuditData({ outboundCrossDomainLinks: { total: 3, withGl: 0 } });
    expect(CROSS_DOMAIN_LINKER_CONFIGURED.test(auditData).status).toBe('fail');
  });
});

// ── L4.2 — _gl parameter appended on outbound links ──────────────────────────

describe('GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS (L4.2)', () => {
  it('is skipped when no outbound cross-domain links were found', () => {
    expect(GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when every outbound link carries _gl', () => {
    const auditData = makeAuditData({ outboundCrossDomainLinks: { total: 3, withGl: 3 } });
    expect(GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS.test(auditData).status).toBe('pass');
  });

  it('fails when only some outbound links carry _gl (partial rollout)', () => {
    const auditData = makeAuditData({ outboundCrossDomainLinks: { total: 3, withGl: 1 } });
    expect(GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS.test(auditData).status).toBe('fail');
  });
});

// ── L4.3 — GA4 client_id persists across the boundary ────────────────────────

describe('GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY (L4.3)', () => {
  it('is skipped when no client_id was observed on either side', () => {
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when only the marketing-side client_id was observed', () => {
    const auditData = makeAuditData({ marketingGa4ClientId: '123.456' });
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData).status).toBe('skipped');
  });

  it('passes when the same client_id is observed on both sides', () => {
    const auditData = makeAuditData({ marketingGa4ClientId: '123.456', productDomainGa4ClientId: '123.456' });
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData).status).toBe('pass');
  });

  it('fails when the client_id changes across the boundary', () => {
    const auditData = makeAuditData({ marketingGa4ClientId: '123.456', productDomainGa4ClientId: '789.012' });
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData).status).toBe('fail');
  });

  it('applies to ecommerce sites too, reading checkout_domain data when product_domain data is absent', () => {
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.applies_to).toContain('ecommerce');
    const auditData = makeAuditData({
      site_type: 'ecommerce',
      marketingGa4ClientId: '123.456',
      checkoutDomainGa4ClientId: '123.456',
    });
    const result = GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.evidence).toContain('checkout domain client_id: 123.456');
  });

  it('fails an ecommerce site when the client_id changes across the checkout boundary', () => {
    const auditData = makeAuditData({
      site_type: 'ecommerce',
      marketingGa4ClientId: '123.456',
      checkoutDomainGa4ClientId: '789.012',
    });
    expect(GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData).status).toBe('fail');
  });

  it('prefers product_domain data over checkout_domain data when both are present', () => {
    const auditData = makeAuditData({
      marketingGa4ClientId: '123.456',
      productDomainGa4ClientId: '123.456',
      checkoutDomainGa4ClientId: '999.999',
    });
    const result = GA4_CLIENT_ID_PERSISTS_ACROSS_BOUNDARY.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.evidence).toContain('product domain client_id: 123.456');
  });
});

// ── L4.4 — Session not restarted at the boundary ─────────────────────────────

describe('SESSION_NOT_RESTARTED_AT_BOUNDARY (L4.4)', () => {
  it('is skipped when no product-domain visit was made', () => {
    expect(SESSION_NOT_RESTARTED_AT_BOUNDARY.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when no session_start fired on the product domain', () => {
    const auditData = makeAuditData({ productDomainSessionStartDetected: false });
    expect(SESSION_NOT_RESTARTED_AT_BOUNDARY.test(auditData).status).toBe('pass');
  });

  it('fails when a session_start fired on the product domain', () => {
    const auditData = makeAuditData({ productDomainSessionStartDetected: true });
    expect(SESSION_NOT_RESTARTED_AT_BOUNDARY.test(auditData).status).toBe('fail');
  });

  it('applies to ecommerce sites too, reading checkout_domain data when product_domain data is absent', () => {
    expect(SESSION_NOT_RESTARTED_AT_BOUNDARY.applies_to).toContain('ecommerce');
    const auditData = makeAuditData({ site_type: 'ecommerce', checkoutDomainSessionStartDetected: false });
    const result = SESSION_NOT_RESTARTED_AT_BOUNDARY.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.evidence).toContain('session_start detected on checkout domain: false');
  });

  it('fails an ecommerce site when a session_start fired on the checkout domain', () => {
    const auditData = makeAuditData({ site_type: 'ecommerce', checkoutDomainSessionStartDetected: true });
    expect(SESSION_NOT_RESTARTED_AT_BOUNDARY.test(auditData).status).toBe('fail');
  });

  it('prefers product_domain data over checkout_domain data when both are present', () => {
    const auditData = makeAuditData({ productDomainSessionStartDetected: false, checkoutDomainSessionStartDetected: true });
    const result = SESSION_NOT_RESTARTED_AT_BOUNDARY.test(auditData);
    expect(result.status).toBe('pass');
    expect(result.technical_details.evidence).toContain('session_start detected on product domain: false');
  });
});

describe('L4_RULES', () => {
  it('exports all 4 crawl-detectable L4 rules', () => {
    expect(L4_RULES).toHaveLength(4);
    expect(new Set(L4_RULES.map((r) => r.id)).size).toBe(4);
    expect(new Set(L4_RULES.map((r) => r.rule_id)).size).toBe(4);
  });

  it('excludes the 5 non-crawl-detectable rules (L4.5-9)', () => {
    expect(L4_RULES.some((r) => ['L4.5', 'L4.6', 'L4.7', 'L4.8', 'L4.9'].includes(r.id))).toBe(false);
  });
});
