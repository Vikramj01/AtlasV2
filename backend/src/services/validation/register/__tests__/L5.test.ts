/**
 * Layer L5 — Event Firing rule tests.
 *
 * Covers each of the 12 crawl-detectable rules' pass/fail/skipped/warning
 * branches. L5.8-9 (SPA route-change correlation / second-pass detectable)
 * are out of scope for this phase — not tested here because they aren't
 * shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  PRIMARY_CONVERSION_EVENT_FIRES,
  GOOGLE_ADS_CONVERSION_EVENT_FIRES,
  META_CONVERSION_EVENT_FIRES,
  TIKTOK_CONVERSION_EVENT_FIRES,
  GA4_CONVERSION_EVENT_FIRES,
  EVENT_FIRES_EXACTLY_ONCE,
  FIRES_ON_COMPLETION_NOT_ON_INTENT,
  PAGE_VIEW_FIRES_ON_EVERY_ROUTE,
  NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES,
  MICRO_CONVERSIONS_FIRE,
  EVENT_NAMES_MATCH_DECLARED_TAXONOMY,
  EVENT_ORDERING_IS_CORRECT,
  L5_RULES,
} from '../L5';
import type { AuditData, DataLayerEvent, NetworkRequest } from '@/types/audit';

function makeEvent(overrides: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { event: 'test_event', timestamp: Date.now(), step: 'confirmation', ...overrides };
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
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta', 'tiktok'],
    steps_visited: ['init', 'landing', 'confirmation'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L5.1 — Primary conversion event fires ────────────────────────────────────

describe('PRIMARY_CONVERSION_EVENT_FIRES (L5.1)', () => {
  it('is skipped when no primary conversion is declared', () => {
    expect(PRIMARY_CONVERSION_EVENT_FIRES.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the declared primary event is observed', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up' })],
    });
    expect(PRIMARY_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('pass');
  });

  it('fails when the declared primary event never fires', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'sign_up', kind: 'primary' }] });
    expect(PRIMARY_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('fail');
  });
});

// ── L5.2-5.4 — Per-platform conversion event fires ───────────────────────────

describe('GOOGLE_ADS_CONVERSION_EVENT_FIRES (L5.2)', () => {
  it('passes when a Google Ads conversion hit is observed', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion/123' })] });
    expect(GOOGLE_ADS_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(GOOGLE_ADS_CONVERSION_EVENT_FIRES.test(makeAuditData()).status).toBe('fail');
  });
});

describe('META_CONVERSION_EVENT_FIRES (L5.3)', () => {
  it('passes when a tracked (non-PageView) event fires', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://www.facebook.com/tr?id=1&ev=Purchase' })] });
    expect(META_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('pass');
  });
  it('fails when only the base PageView pixel call is observed', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://www.facebook.com/tr?id=1&ev=PageView' })] });
    expect(META_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('fail');
  });
});

describe('TIKTOK_CONVERSION_EVENT_FIRES (L5.4)', () => {
  it('passes when a POST to the tracking endpoint is observed', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ url: 'https://analytics.tiktok.com/api/v2/pixel/track', method: 'POST' })] });
    expect(TIKTOK_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('pass');
  });
  it('fails otherwise', () => {
    expect(TIKTOK_CONVERSION_EVENT_FIRES.test(makeAuditData()).status).toBe('fail');
  });
});

// ── L5.5 — GA4 conversion event fires ─────────────────────────────────────────

describe('GA4_CONVERSION_EVENT_FIRES (L5.5)', () => {
  it('is skipped when no primary conversion is declared', () => {
    expect(GA4_CONVERSION_EVENT_FIRES.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when a GA4 hit with en= matching the declared conversion fires', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      networkRequests: [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&en=sign_up' })],
    });
    expect(GA4_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('pass');
  });

  it('fails when no matching GA4 hit is observed', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'sign_up', kind: 'primary' }] });
    expect(GA4_CONVERSION_EVENT_FIRES.test(auditData).status).toBe('fail');
  });
});

// ── L5.6 — Event fires exactly once ──────────────────────────────────────────

describe('EVENT_FIRES_EXACTLY_ONCE (L5.6)', () => {
  it('is skipped when no primary conversion is declared', () => {
    expect(EVENT_FIRES_EXACTLY_ONCE.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when the primary conversion never fired', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'sign_up', kind: 'primary' }] });
    expect(EVENT_FIRES_EXACTLY_ONCE.test(auditData).status).toBe('skipped');
  });

  it('passes when it fires exactly once', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up', step: 'confirmation' })],
    });
    expect(EVENT_FIRES_EXACTLY_ONCE.test(auditData).status).toBe('pass');
  });

  it('fails when it fires twice on the same step', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [
        makeEvent({ event: 'sign_up', step: 'confirmation' }),
        makeEvent({ event: 'sign_up', step: 'confirmation' }),
      ],
    });
    expect(EVENT_FIRES_EXACTLY_ONCE.test(auditData).status).toBe('fail');
  });
});

// ── L5.7 — Fires on completion, not on intent ────────────────────────────────

describe('FIRES_ON_COMPLETION_NOT_ON_INTENT (L5.7)', () => {
  it('is skipped when the primary conversion never fired', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'sign_up', kind: 'primary' }] });
    expect(FIRES_ON_COMPLETION_NOT_ON_INTENT.test(auditData).status).toBe('skipped');
  });

  it('passes when it only fires at the completion step', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up', step: 'confirmation' })],
    });
    expect(FIRES_ON_COMPLETION_NOT_ON_INTENT.test(auditData).status).toBe('pass');
  });

  it('fails when it fires at an earlier (intent) step', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up', step: 'landing' })],
    });
    expect(FIRES_ON_COMPLETION_NOT_ON_INTENT.test(auditData).status).toBe('fail');
  });
});

// ── L5.10 — page_view fires on every route ────────────────────────────────────

describe('PAGE_VIEW_FIRES_ON_EVERY_ROUTE (L5.10)', () => {
  it('is skipped when fewer than 2 steps were sampled', () => {
    const auditData = makeAuditData({ steps_visited: ['init', 'landing'] });
    expect(PAGE_VIEW_FIRES_ON_EVERY_ROUTE.test(auditData).status).toBe('skipped');
  });

  it('passes when page_view is recorded on every route', () => {
    const auditData = makeAuditData({
      dataLayer: [makeEvent({ event: 'page_view', step: 'landing' }), makeEvent({ event: 'page_view', step: 'confirmation' })],
    });
    expect(PAGE_VIEW_FIRES_ON_EVERY_ROUTE.test(auditData).status).toBe('pass');
  });

  it('fails when a route has no page_view', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event: 'page_view', step: 'landing' })] });
    expect(PAGE_VIEW_FIRES_ON_EVERY_ROUTE.test(auditData).status).toBe('fail');
  });
});

// ── L5.11 — No conversion fires on non-conversion pages ──────────────────────

describe('NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES (L5.11)', () => {
  it('is skipped when the primary conversion never fired', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'sign_up', kind: 'primary' }] });
    expect(NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES.test(auditData).status).toBe('skipped');
  });

  it('passes when it only fires on the conversion surface', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up', step: 'confirmation' })],
    });
    expect(NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES.test(auditData).status).toBe('pass');
  });

  it('fails when it also fires on a non-conversion page', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [
        makeEvent({ event: 'sign_up', step: 'confirmation' }),
        makeEvent({ event: 'sign_up', step: 'landing' }),
      ],
    });
    expect(NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES.test(auditData).status).toBe('fail');
  });
});

// ── L5.12 — Micro-conversions fire ────────────────────────────────────────────

describe('MICRO_CONVERSIONS_FIRE (L5.12)', () => {
  it('is skipped when no secondary conversions are declared', () => {
    expect(MICRO_CONVERSIONS_FIRE.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when all declared micro-conversions fire', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'add_to_cart', kind: 'secondary' }],
      dataLayer: [makeEvent({ event: 'add_to_cart' })],
    });
    expect(MICRO_CONVERSIONS_FIRE.test(auditData).status).toBe('pass');
  });

  it('warns when some but not all fire', () => {
    const auditData = makeAuditData({
      declared_conversions: [
        { name: 'add_to_cart', kind: 'secondary' },
        { name: 'view_pricing', kind: 'secondary' },
      ],
      dataLayer: [makeEvent({ event: 'add_to_cart' })],
    });
    expect(MICRO_CONVERSIONS_FIRE.test(auditData).status).toBe('warning');
  });

  it('fails when none fire', () => {
    const auditData = makeAuditData({ declared_conversions: [{ name: 'add_to_cart', kind: 'secondary' }] });
    expect(MICRO_CONVERSIONS_FIRE.test(auditData).status).toBe('fail');
  });
});

// ── L5.13 — Event names match the declared taxonomy ──────────────────────────

describe('EVENT_NAMES_MATCH_DECLARED_TAXONOMY (L5.13)', () => {
  it('is skipped when no dataLayer events were observed', () => {
    expect(EVENT_NAMES_MATCH_DECLARED_TAXONOMY.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when observed event names follow the default (snake_case) convention', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event: 'add_to_cart' }), makeEvent({ event: 'sign_up' })] });
    expect(EVENT_NAMES_MATCH_DECLARED_TAXONOMY.test(auditData).status).toBe('pass');
  });

  it('fails when an observed event name violates the convention', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event: 'AddToCart' })] });
    expect(EVENT_NAMES_MATCH_DECLARED_TAXONOMY.test(auditData).status).toBe('fail');
  });
});

// ── L5.14 — Event ordering is correct ─────────────────────────────────────────

describe('EVENT_ORDERING_IS_CORRECT (L5.14)', () => {
  it('is skipped when there is no GTM load to establish a baseline', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      dataLayer: [makeEvent({ event: 'sign_up', timestamp: 1000 })],
    });
    expect(EVENT_ORDERING_IS_CORRECT.test(auditData).status).toBe('skipped');
  });

  it('passes when the conversion fires after GTM loads', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      networkRequests: [makeRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC', timestamp: 1000 })],
      dataLayer: [makeEvent({ event: 'sign_up', timestamp: 2000 })],
    });
    expect(EVENT_ORDERING_IS_CORRECT.test(auditData).status).toBe('pass');
  });

  it('fails when the conversion fires before GTM loads', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
      networkRequests: [makeRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC', timestamp: 2000 })],
      dataLayer: [makeEvent({ event: 'sign_up', timestamp: 1000 })],
    });
    expect(EVENT_ORDERING_IS_CORRECT.test(auditData).status).toBe('fail');
  });
});

describe('L5_RULES', () => {
  it('exports all 12 crawl-detectable L5 rules', () => {
    expect(L5_RULES).toHaveLength(12);
    expect(new Set(L5_RULES.map((r) => r.id)).size).toBe(12);
    expect(new Set(L5_RULES.map((r) => r.rule_id)).size).toBe(12);
  });

  it('excludes L5.8 (needs in-page navigation capture) and L5.9 (second-pass detectable)', () => {
    expect(L5_RULES.some((r) => ['L5.8', 'L5.9'].includes(r.id))).toBe(false);
  });
});
