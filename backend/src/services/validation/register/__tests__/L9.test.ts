/**
 * Layer L9 — Server-Side Delivery rule tests.
 *
 * Scoped to what L1.14/L1.15 (foundation_tags) don't already cover: the
 * client's DB-verified sGTM connection (sgtmVerified) and whether that
 * verified connection's traffic actually showed up in this crawl.
 */
import { describe, it, expect } from 'vitest';
import { SERVER_SIDE_GTM_CONNECTION_VERIFIED, VERIFIED_SGTM_TRAFFIC_OBSERVED, L9_RULES } from '../L9';
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
    declared_platforms: ['google_ads'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L9.1 — Server-side GTM connection verified ───────────────────────────────

describe('SERVER_SIDE_GTM_CONNECTION_VERIFIED (L9.1)', () => {
  it('is skipped when no sGTM connection exists for this client', () => {
    expect(SERVER_SIDE_GTM_CONNECTION_VERIFIED.test(makeAuditData({ sgtmVerified: undefined })).status).toBe('skipped');
  });

  it('passes when the connection is verified', () => {
    expect(SERVER_SIDE_GTM_CONNECTION_VERIFIED.test(makeAuditData({ sgtmVerified: true })).status).toBe('pass');
  });

  it('fails when a connected endpoint failed verification', () => {
    expect(SERVER_SIDE_GTM_CONNECTION_VERIFIED.test(makeAuditData({ sgtmVerified: false })).status).toBe('fail');
  });
});

// ── L9.2 — Verified connection's traffic observed this crawl ────────────────

describe('VERIFIED_SGTM_TRAFFIC_OBSERVED (L9.2)', () => {
  it('is skipped when there is no verified sGTM connection to cross-check', () => {
    expect(VERIFIED_SGTM_TRAFFIC_OBSERVED.test(makeAuditData({ sgtmVerified: undefined })).status).toBe('skipped');
  });

  it('is skipped when the connection exists but failed verification (L9.1 already covers that failure)', () => {
    expect(VERIFIED_SGTM_TRAFFIC_OBSERVED.test(makeAuditData({ sgtmVerified: false })).status).toBe('skipped');
  });

  it('passes when sGTM-shaped traffic was observed this crawl for a verified connection', () => {
    const auditData = makeAuditData({
      sgtmVerified: true,
      networkRequests: [makeRequest({ url: 'https://sgtm.example.com/g/collect' })],
    });
    expect(VERIFIED_SGTM_TRAFFIC_OBSERVED.test(auditData).status).toBe('pass');
  });

  it('fails when the connection is verified but no sGTM-shaped traffic showed up this crawl', () => {
    const auditData = makeAuditData({ sgtmVerified: true, networkRequests: [] });
    const result = VERIFIED_SGTM_TRAFFIC_OBSERVED.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.found).toContain('verified in Atlas');
  });
});

describe('L9_RULES', () => {
  it('exports both L9 rules', () => {
    expect(L9_RULES).toHaveLength(2);
    expect(new Set(L9_RULES.map((r) => r.id)).size).toBe(2);
    expect(new Set(L9_RULES.map((r) => r.rule_id)).size).toBe(2);
  });

  it('every rule declares layer "server_side_delivery"', () => {
    expect(L9_RULES.every((r) => r.layer === 'server_side_delivery')).toBe(true);
  });
});
