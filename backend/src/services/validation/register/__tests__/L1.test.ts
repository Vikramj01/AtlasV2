/**
 * Layer L1 — Foundation & Tags rule tests.
 *
 * Covers each of the 16 rules' pass/fail/skipped/warning branches.
 */
import { describe, it, expect } from 'vitest';
import {
  GTM_CONTAINER_LOADED,
  CONTAINER_ID_MATCHES_DECLARED,
  DATALAYER_INITIALISED,
  GA4_CONFIG_TAG_PRESENT,
  GOOGLE_GLOBAL_SITE_TAG_PRESENT,
  CONVERSION_LINKER_ENABLED,
  META_PIXEL_PRESENT,
  TIKTOK_PIXEL_PRESENT,
  LINKEDIN_INSIGHT_TAG_PRESENT,
  MICROSOFT_UET_TAG_PRESENT,
  NO_DUPLICATE_CONTAINER,
  NO_DUPLICATE_BASE_TAG,
  TAGS_PRESENT_ACROSS_SAMPLED_PAGES,
  SERVER_CONTAINER_ENDPOINT_CONFIGURED,
  SERVER_CONTAINER_FIRST_PARTY_DOMAIN,
  NO_TAG_LOAD_ERRORS,
  L1_RULES,
} from '../L1';
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

// ── L1.1 — GTM container loaded ──────────────────────────────────────────────

describe('GTM_CONTAINER_LOADED (L1.1)', () => {
  it('passes when a gtm.js script tag with an id resolves', () => {
    const auditData = makeAuditData({
      pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] },
    });
    expect(GTM_CONTAINER_LOADED.test(auditData).status).toBe('pass');
  });

  it('fails when no gtm.js script is present', () => {
    expect(GTM_CONTAINER_LOADED.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L1.2 — Container ID matches declared account ─────────────────────────────

describe('CONTAINER_ID_MATCHES_DECLARED (L1.2)', () => {
  it('is skipped when no container is connected/declared', () => {
    const result = CONTAINER_ID_MATCHES_DECLARED.test(makeAuditData());
    expect(result.status).toBe('skipped');
  });

  it('passes when the live container matches the declared account', () => {
    const auditData = makeAuditData({
      connected_gtm_container_id: 'GTM-ABC123',
      pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] },
    });
    expect(CONTAINER_ID_MATCHES_DECLARED.test(auditData).status).toBe('pass');
  });

  it('fails when the live container differs from the declared account', () => {
    const auditData = makeAuditData({
      connected_gtm_container_id: 'GTM-ABC123',
      pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-STAGING'] },
    });
    expect(CONTAINER_ID_MATCHES_DECLARED.test(auditData).status).toBe('fail');
  });

  it('fails when nothing loads at all but an account is declared', () => {
    const auditData = makeAuditData({ connected_gtm_container_id: 'GTM-ABC123' });
    expect(CONTAINER_ID_MATCHES_DECLARED.test(auditData).status).toBe('fail');
  });
});

// ── L1.3 — dataLayer initialised ─────────────────────────────────────────────

describe('DATALAYER_INITIALISED (L1.3)', () => {
  it('fails when dataLayer never received a push', () => {
    expect(DATALAYER_INITIALISED.test(makeAuditData()).status).toBe('fail');
  });

  it('passes when dataLayer is populated by the landing step', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }],
    });
    expect(DATALAYER_INITIALISED.test(auditData).status).toBe('pass');
  });

  it('warns when dataLayer is only populated at a later step', () => {
    const auditData = makeAuditData({
      dataLayer: [{ event: 'add_to_cart', timestamp: Date.now(), step: 'cart' }],
    });
    expect(DATALAYER_INITIALISED.test(auditData).status).toBe('warning');
  });
});

// ── L1.4 — GA4 configuration tag present ─────────────────────────────────────

describe('GA4_CONFIG_TAG_PRESENT (L1.4)', () => {
  it('passes when a GA4 collect request fires', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC123' })],
    });
    expect(GA4_CONFIG_TAG_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when no GA4 request is found', () => {
    expect(GA4_CONFIG_TAG_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L1.5 — Google global site tag present ────────────────────────────────────

describe('GOOGLE_GLOBAL_SITE_TAG_PRESENT (L1.5)', () => {
  it('passes when gtag.js loads with an Ads conversion ID', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.googletagmanager.com/gtag/js?id=AW-123456789' })],
    });
    expect(GOOGLE_GLOBAL_SITE_TAG_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when no gtag.js AW- loader is found', () => {
    expect(GOOGLE_GLOBAL_SITE_TAG_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L1.6 — Conversion linker enabled ─────────────────────────────────────────

describe('CONVERSION_LINKER_ENABLED (L1.6)', () => {
  it('passes when the _gcl_au cookie is present', () => {
    const auditData = makeAuditData({ cookies: { _gcl_au: '1.1.123.456' } });
    expect(CONVERSION_LINKER_ENABLED.test(auditData).status).toBe('pass');
  });

  it('fails when the _gcl_au cookie is absent', () => {
    expect(CONVERSION_LINKER_ENABLED.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L1.7-10 — Per-platform pixel presence ────────────────────────────────────

describe('META_PIXEL_PRESENT (L1.7)', () => {
  it('passes when facebook.com/tr fires', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://www.facebook.com/tr?id=123' })] });
    expect(META_PIXEL_PRESENT.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(META_PIXEL_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

describe('TIKTOK_PIXEL_PRESENT (L1.8)', () => {
  it('passes when analytics.tiktok.com fires', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://analytics.tiktok.com/i18n/pixel/events.js' })] });
    expect(TIKTOK_PIXEL_PRESENT.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(TIKTOK_PIXEL_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

describe('LINKEDIN_INSIGHT_TAG_PRESENT (L1.9)', () => {
  it('passes when snap.licdn.com fires', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js' })] });
    expect(LINKEDIN_INSIGHT_TAG_PRESENT.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(LINKEDIN_INSIGHT_TAG_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

describe('MICROSOFT_UET_TAG_PRESENT (L1.10)', () => {
  it('passes when bat.bing.com fires', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://bat.bing.com/action/0?ti=123456' })] });
    expect(MICROSOFT_UET_TAG_PRESENT.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(MICROSOFT_UET_TAG_PRESENT.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L1.11 — No duplicate container ───────────────────────────────────────────

describe('NO_DUPLICATE_CONTAINER (L1.11)', () => {
  it('is skipped when no container loads', () => {
    expect(NO_DUPLICATE_CONTAINER.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when exactly one container loads', () => {
    const auditData = makeAuditData({ pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] } });
    expect(NO_DUPLICATE_CONTAINER.test(auditData).status).toBe('pass');
  });

  it('fails when 2+ distinct containers load', () => {
    const auditData = makeAuditData({
      pageMetadata: {
        gtm_script_srcs: [
          'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123',
          'https://www.googletagmanager.com/gtm.js?id=GTM-LEGACY9',
        ],
      },
    });
    expect(NO_DUPLICATE_CONTAINER.test(auditData).status).toBe('fail');
  });
});

// ── L1.12 — No duplicate base tag ────────────────────────────────────────────

describe('NO_DUPLICATE_BASE_TAG (L1.12)', () => {
  it('passes when each ID-bearing platform has at most one ID', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC123' })],
    });
    expect(NO_DUPLICATE_BASE_TAG.test(auditData).status).toBe('pass');
  });

  it('fails when GA4 fires under two distinct measurement IDs', () => {
    const auditData = makeAuditData({
      networkRequests: [
        makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC123' }),
        makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-XYZ999' }),
      ],
    });
    expect(NO_DUPLICATE_BASE_TAG.test(auditData).status).toBe('fail');
  });
});

// ── L1.13 — Tags present across all sampled pages ────────────────────────────

describe('TAGS_PRESENT_ACROSS_SAMPLED_PAGES (L1.13)', () => {
  it('is skipped when fewer than 2 steps were sampled', () => {
    const auditData = makeAuditData({ steps_visited: ['init', 'landing'] });
    expect(TAGS_PRESENT_ACROSS_SAMPLED_PAGES.test(auditData).status).toBe('skipped');
  });

  it('passes when every sampled step has a tracked request', () => {
    const auditData = makeAuditData({
      steps_visited: ['init', 'landing', 'confirmation'],
      networkRequests: [
        makeRequest({ step: 'landing', url: 'https://www.google-analytics.com/g/collect' }),
        makeRequest({ step: 'confirmation', url: 'https://www.google-analytics.com/g/collect' }),
      ],
    });
    expect(TAGS_PRESENT_ACROSS_SAMPLED_PAGES.test(auditData).status).toBe('pass');
  });

  it('fails when a sampled step has zero tracked requests', () => {
    const auditData = makeAuditData({
      steps_visited: ['init', 'landing', 'confirmation'],
      networkRequests: [makeRequest({ step: 'landing', url: 'https://www.google-analytics.com/g/collect' })],
    });
    const result = TAGS_PRESENT_ACROSS_SAMPLED_PAGES.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.found).toContain('confirmation');
  });
});

// ── L1.14 — Server container endpoint configured ─────────────────────────────

describe('SERVER_CONTAINER_ENDPOINT_CONFIGURED (L1.14)', () => {
  it('fails when no sGTM-shaped request is detected', () => {
    expect(SERVER_CONTAINER_ENDPOINT_CONFIGURED.test(makeAuditData()).status).toBe('fail');
  });

  it('passes when an sGTM-shaped request is detected', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://tracking.example.com/sgtm/collect' })],
    });
    expect(SERVER_CONTAINER_ENDPOINT_CONFIGURED.test(auditData).status).toBe('pass');
  });
});

// ── L1.15 — Server container on a first-party domain ─────────────────────────

describe('SERVER_CONTAINER_FIRST_PARTY_DOMAIN (L1.15)', () => {
  it('is skipped when no server container endpoint was detected', () => {
    expect(SERVER_CONTAINER_FIRST_PARTY_DOMAIN.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the candidate endpoint shares the site\'s base domain', () => {
    const auditData = makeAuditData({
      website_url: 'https://example.com',
      networkRequests: [makeRequest({ url: 'https://tracking.example.com/sgtm/collect' })],
    });
    expect(SERVER_CONTAINER_FIRST_PARTY_DOMAIN.test(auditData).status).toBe('pass');
  });

  it('fails when the candidate endpoint is on a third-party domain', () => {
    const auditData = makeAuditData({
      website_url: 'https://example.com',
      networkRequests: [makeRequest({ url: 'https://tagging.sgtm-vendor.io/collect' })],
    });
    expect(SERVER_CONTAINER_FIRST_PARTY_DOMAIN.test(auditData).status).toBe('fail');
  });
});

// ── L1.16 — No tag load errors ────────────────────────────────────────────────

describe('NO_TAG_LOAD_ERRORS (L1.16)', () => {
  it('passes when no request failed or errored', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect', statusCode: 200 })],
    });
    expect(NO_TAG_LOAD_ERRORS.test(auditData).status).toBe('pass');
  });

  it('fails when a tracked request failed at the network level', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://www.facebook.com/tr', failed: true })],
    });
    expect(NO_TAG_LOAD_ERRORS.test(auditData).status).toBe('fail');
  });

  it('fails when a tracked request returned a 4xx/5xx status', () => {
    const auditData = makeAuditData({
      networkRequests: [makeRequest({ url: 'https://bat.bing.com/action/0', statusCode: 503 })],
    });
    expect(NO_TAG_LOAD_ERRORS.test(auditData).status).toBe('fail');
  });
});

describe('L1_RULES', () => {
  it('exports all 16 L1 rules', () => {
    expect(L1_RULES).toHaveLength(16);
    expect(new Set(L1_RULES.map((r) => r.id)).size).toBe(16);
    expect(new Set(L1_RULES.map((r) => r.rule_id)).size).toBe(16);
  });
});

