/**
 * Variance regression harness (Platform Attribution & Determinism PRD
 * Part B, B-W6) — "a test that runs the same fixture through the pipeline
 * N times and asserts identical ValidationResult statuses. Without this,
 * determinism regresses the first time someone touches the navigation
 * path."
 *
 * Two things are tested here:
 *  1. The register itself is pure/synchronous (engine.ts's runRegister) —
 *     running the exact same AuditData through it N times must produce
 *     byte-identical results every time. This can't catch non-determinism
 *     introduced by a real browser (that lives in journeySimulator.ts,
 *     untestable without Browserbase), but it does catch the register ever
 *     regressing into reading real wall-clock time, Math.random(), Set/Map
 *     iteration order, or anything else that could make two runs of
 *     identical input disagree.
 *  2. The exact openart.ai correlated-failure shape (§B1: one degraded
 *     step producing both a false-fail and a false-pass) is caught by the
 *     full reporting pipeline (runRegister + partitionCoverageAffected +
 *     partitionDegradedRuns), end to end — this is the regression test for
 *     the specific defect the PRD was written to fix, not just a generic
 *     "nothing changed" check.
 */
import { describe, it, expect } from 'vitest';
import { runRegister } from '../engine';
import { partitionCoverageAffected } from '@/services/reporting/coverageSuppression';
import { partitionDegradedRuns } from '@/services/reporting/degradationSuppression';
import type { AuditData, DataLayerEvent, NetworkRequest, StepCoverage } from '@/types/audit';

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

/** A settled, well-instrumented multi-platform site — every step reached, nothing degraded. */
function makeSettledAuditData(): AuditData {
  const hashedEmail = 'a'.repeat(64);
  const stepCoverage: StepCoverage[] = [
    { step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com', source: 'user_supplied', distinct_from_landing: false, navigation_success: true, settle_outcome: 'settled', degraded: false },
    { step: 'confirmation', requested_url: 'https://shop.example.com/order-confirmed', final_url: 'https://shop.example.com/order-confirmed', source: 'user_supplied', distinct_from_landing: true, navigation_success: true, settle_outcome: 'settled', degraded: false },
  ];

  return {
    audit_id: 'audit-variance-settled',
    website_url: 'https://shop.example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'ecommerce',
    declared_platforms: ['google_ads', 'tiktok'],
    primary_channel: 'google_ads',
    traffic_regions: ['us'],
    declared_conversions: [{ name: 'purchase', kind: 'primary' }],
    steps_visited: ['init', 'landing', 'confirmation'],
    step_coverage: stepCoverage,
    landing_final_url: 'https://shop.example.com/?gclid=test_gclid_1&ttclid=test_ttclid_1',
    urlParams: { gclid: 'test_gclid_1', ttclid: 'test_ttclid_1' },
    cookies: {
      gclid: 'test_gclid_1', _gcl_aw: 'GCL.1.abc',
      ttclid: 'test_ttclid_1', _ttp: 'ttp.1.1',
    },
    storage: {},
    sessionStorage: {},
    detailedCookies: [
      { name: '_gcl_aw', value: 'GCL.1.abc', domain: '.shop.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 90 * 86_400, secure: true, sameSite: 'Lax' },
      { name: '_ttp', value: 'ttp.1.1', domain: '.shop.example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 13 * 30 * 86_400, secure: true, sameSite: 'Lax' },
    ],
    consoleErrors: [],
    dataLayer: [
      makeEvent({ event: 'page_view', step: 'landing' }),
      makeEvent({
        event: 'purchase', step: 'confirmation', value: 50, currency: 'USD',
        transaction_id: 'ORDER-1', event_id: 'evt-1',
        user_data: { email: hashedEmail },
      }),
    ],
    networkRequests: [
      makeRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123', step: 'landing' }),
      makeRequest({ url: 'https://www.googletagmanager.com/gtag/js?id=AW-123456789', step: 'landing' }),
      // TikTok pixel loads AND fires a conversion event — the "settled" baseline.
      makeRequest({ url: 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=1', step: 'landing' }),
      makeRequest({ url: 'https://analytics.tiktok.com/api/v2/pixel', method: 'POST', step: 'confirmation' }),
      makeRequest({ url: 'https://www.googleadservices.com/pagead/conversion/123', step: 'confirmation' }),
    ],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: 'test_gclid_1', fbclid: '', ttclid: 'test_ttclid_1' },
    pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] },
  };
}

/**
 * The openart.ai correlated-failure shape (PRD §B1): the TikTok pixel
 * request on landing fails outright, so it never fires a conversion event
 * later AND never sets its _ttp-style cookie — landing itself is marked
 * degraded (settle hit its cap / navigation-adjacent failure), which is
 * the one upstream fact runRegister alone has no way to know about.
 */
function makeDegradedAuditData(): AuditData {
  const settled = makeSettledAuditData();
  return {
    ...settled,
    audit_id: 'audit-variance-degraded',
    step_coverage: settled.step_coverage!.map((s) => (s.step === 'landing' ? { ...s, settle_outcome: 'quiet_period_cap_reached', degraded: true } : s)),
    // The TikTok pixel never loaded, so it never fired a conversion event...
    networkRequests: settled.networkRequests.filter((r) => !r.url.includes('analytics.tiktok.com/api/v2/pixel')),
    // ...and never wrote its own cookie either — nothing for the lifetime rule to fail on.
    cookies: { gclid: settled.cookies!['gclid'], _gcl_aw: settled.cookies!['_gcl_aw'] },
    detailedCookies: settled.detailedCookies!.filter((c) => c.name !== '_ttp'),
  };
}

describe('Variance regression harness (B-W6)', () => {
  it('runRegister produces byte-identical results across 20 runs of the same settled AuditData', () => {
    const auditData = makeSettledAuditData();
    const first = JSON.stringify(runRegister(auditData));
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(runRegister(auditData))).toBe(first);
    }
  });

  it('runRegister produces byte-identical results across 20 runs of the same degraded AuditData', () => {
    const auditData = makeDegradedAuditData();
    const first = JSON.stringify(runRegister(auditData));
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(runRegister(auditData))).toBe(first);
    }
  });

  it('the settled run scores TikTok\'s conversion event and storage lifetime as real, confident verdicts', () => {
    const auditData = makeSettledAuditData();
    const results = runRegister(auditData);
    const { assessable: coverageAssessable } = partitionCoverageAffected(results, auditData.step_coverage);
    const { assessable, unassessable } = partitionDegradedRuns(coverageAssessable, auditData.step_coverage);

    expect(unassessable).toEqual([]);
    const byId = new Map(assessable.map((r) => [r.rule_id, r]));
    expect(byId.get('TIKTOK_CONVERSION_EVENT_FIRES')?.status).toBe('pass');
    expect(byId.get('STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW')?.status).toBe('pass');
  });

  it('the degraded run — same site, one step that never settled — routes both the false-fail and the false-pass to could_not_be_assessed instead of scoring them', () => {
    const auditData = makeDegradedAuditData();
    const results = runRegister(auditData);
    const { assessable: coverageAssessable } = partitionCoverageAffected(results, auditData.step_coverage);
    const { assessable, unassessable } = partitionDegradedRuns(coverageAssessable, auditData.step_coverage);

    const unassessableIds = unassessable.map((u) => u.rule_id);
    expect(unassessableIds).toContain('TIKTOK_CONVERSION_EVENT_FIRES');
    expect(unassessableIds).toContain('STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW');

    // Neither rule stands as a scored pass/fail in the assessable set once
    // routed — this is the actual behavioural difference from the settled
    // run above, not just "the rule ran the same way."
    const assessableIds = new Set(assessable.map((r) => r.rule_id));
    expect(assessableIds.has('TIKTOK_CONVERSION_EVENT_FIRES')).toBe(false);
    expect(assessableIds.has('STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW')).toBe(false);

    // A rule unrelated to the degraded step is untouched — this isn't a
    // blanket "degraded run means nothing counts" suppression.
    expect(assessableIds.has('GTM_CONTAINER_LOADED')).toBe(true);
  });
});
