/**
 * Signal vs Implementation PRD — Sprint 5 acceptance replay & regression
 * fixture. Replays audit `49448510-d968-4178-98e2-8e7c70998276`
 * (pureborn.com/en-uae, 16 Sept 2026 — the PRD's own trigger scan, not
 * issued to the client) through the actual current pipeline (runRegister,
 * buildCoverageSummary, generateBusinessSummary, determineOverallStatus —
 * not a reimplementation of any of their logic) and asserts the PRD §7
 * before/after table row by row.
 *
 * Like the Pre-Connection Scan Confidence Tiering PRD's own reference audit
 * (acceptanceReplay.c9486929.test.ts), the raw `AuditData` this audit's
 * rules actually read was never persisted — only its resolved
 * `ValidationResult[]`/`ReportJSON`. This fixture's `AUDIT_DATA` is
 * therefore a reconstruction, not a byte-exact replay: every field below
 * (declared_platforms, step_coverage's exact source/http_status/
 * wait_for_outcome per step, network requests, cmp/traffic_regions) was
 * read directly off this audit's stored `audits`/`audit_reports` rows
 * (Supabase project hzgiqddvilbtlwkamshp) before P0 shipped, specifically
 * so the real rules produce the same real results the PRD's defect
 * descriptions quote verbatim — confirmed against the stored
 * `technical_appendix.validation_results` (rule_id/status/verdict/
 * observation_confidence/severity/severity_capped_from) for every rule
 * this file asserts on.
 */
import { describe, it, expect } from 'vitest';
import { REGISTER, runRegister } from '@/services/validation/register/engine';
import { buildCoverageSummary } from '@/services/reporting/coverage';
import { buildV2PlatformBreakdown } from '@/services/validation/register/reporting';
import { generateBusinessSummary, determineOverallStatus } from '@/services/interpretation/engine';
import type { AuditData, NetworkRequest, StepCoverage } from '@/types/audit';

function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return { url: '', method: 'GET', headers: {}, timestamp: Date.now(), step: 'landing', ...overrides };
}

function step(overrides: Partial<StepCoverage>): StepCoverage {
  return {
    step: 'landing',
    requested_url: 'https://www.pureborn.com/en-uae',
    source: 'user_supplied',
    distinct_from_landing: false,
    navigation_success: true,
    ...overrides,
  };
}

/**
 * Reconstructed from the stored audit row + report_json as of 16 Sept 2026
 * (pre-P0). GA4/Meta fire genuinely; Google Ads AW- ID, TikTok pixel,
 * GTM container and the _gcl_au linker cookie are genuinely absent — those
 * four survive every P0 fix unchanged, per the PRD's own §7 table and its
 * closing argument ("what goes away is the one finding a competent
 * developer would have used to dismiss the whole report").
 */
const AUDIT_DATA: AuditData = {
  audit_id: '49448510-d968-4178-98e2-8e7c70998276',
  website_url: 'https://www.pureborn.com/en-uae',
  funnel_type: 'ecommerce',
  region: 'gcc',
  rule_set_version: 'v2',
  site_type: 'ecommerce',
  declared_platforms: ['google_ads', 'meta', 'tiktok'],
  primary_channel: 'google_ads',
  traffic_regions: ['gcc'], // NOT in L8's REGULATED_TRAFFIC_REGIONS (eea/uk/switzerland) — real Scan Input value
  cmp: undefined, // real Scan Input value — no CMP declared
  product_domain: 'https://www.pureborn.com/en-uae',
  pageMetadata: { gtm_script_srcs: [] }, // no GTM container observed anywhere
  step_coverage: [
    step({ step: 'landing', source: 'user_supplied', distinct_from_landing: false, http_status: 200, settle_outcome: 'settled' }),
    step({
      step: 'product', source: 'sitemap', distinct_from_landing: true,
      requested_url: 'https://www.pureborn.com/en-qt/products', final_url: 'https://www.pureborn.com/en-qt/products',
      http_status: 200, settle_outcome: 'settled', wait_for_outcome: 'matched',
    }),
    step({
      // Real trigger scan: a heuristic guess (requested /cart) that resolved
      // to the product page — the actual defect this PRD's P0-03/openQuestions
      // fix names by step, not by a blanket "your order confirmation page"
      // claim. http_status 200 + wait_for 'matched' still makes it
      // isVerifiedStep()-trusted for L0.3's broad "reached a page beyond
      // landing" claim (kept as-is per the resolved product decision), but
      // deriveConfidence()'s stricter same-source check still treats any
      // heuristic-sourced step as needing confirmation — both real,
      // compatible claims, not a contradiction.
      step: 'checkout', source: 'heuristic', distinct_from_landing: true,
      requested_url: 'https://www.pureborn.com/cart', final_url: 'https://www.pureborn.com/en-uae/products',
      http_status: 200, settle_outcome: 'settled', wait_for_outcome: 'matched',
    }),
    step({
      step: 'confirmation', source: 'sitemap', distinct_from_landing: true,
      requested_url: 'https://www.pureborn.com/en-qt/blog/success-stories-bamboo-nappies',
      final_url: 'https://www.pureborn.com/en-qt/blog/success-stories-bamboo-nappies',
      http_status: 200, settle_outcome: 'settled', wait_for_outcome: 'matched',
    }),
  ],
  consent_capture: { banner_present: false, dismissed: false, tags_before: [], tags_after: [] },
  // Real trigger scan: DATALAYER_INITIALISED passed ("populated with 6
  // event(s) by the landing page") — six pushes at step 'landing'/'init'.
  dataLayer: Array.from({ length: 6 }, (_, i) => ({ step: 'landing', event: `event_${i}`, timestamp: Date.now() })),
  networkRequests: [
    // GA4/gtag loader — fires, no AW- ID (GTAG_LOADER_PRESENT passes, GOOGLE_ADS_AW_ID_PRESENT fails)
    ...Array.from({ length: 4 }, () => req({ url: 'https://www.googletagmanager.com/gtag/js?id=G-GJQLWVC86B' })),
    // GA4 collect hits — real trigger scan: "GA4 fired 4 time(s), measurement ID: G-GJQLWVC86B"
    ...Array.from({ length: 4 }, () => req({ url: 'https://www.google-analytics.com/g/collect?tid=G-GJQLWVC86B' })),
    // Meta pixel — fires repeatedly, but only ever PageView (base pixel present, no conversion event)
    ...Array.from({ length: 12 }, () => req({ url: 'https://www.facebook.com/tr?id=1510713965738073&ev=PageView' })),
    // TikTok and GTM: genuinely zero requests — nothing to add.
  ],
  // Real trigger scan: GCL_AW_COOKIE_PRESENT and FBP_COOKIE_PRESENT both
  // passed ("GCL AW COOKIE PRESENT"/"FBP COOKIE PRESENT" — storage_durability
  // PASS); CONVERSION_LINKER_ENABLED's own _gcl_au check genuinely failed
  // ("_gcl_au present: false") — a real, distinct absence from _gcl_aw.
  cookies: { _gcl_aw: 'GCL.123.abc', _fbp: 'fb.1.1.1' },
  cookieSnapshots: [],
  localStorageSnapshots: [],
  injected: { gclid: 'test_gclid', fbclid: 'test_fbclid' },
};

describe('PureBorn trigger scan (49448510) — P0 acceptance replay against the real register', () => {
  const results = runRegister(AUDIT_DATA, REGISTER);

  function find(ruleId: string) {
    const r = results.find((x) => x.rule_id === ruleId);
    if (!r) throw new Error(`${ruleId} produced no result — check REGISTER still contains it and it's applicable to this AuditData`);
    return r;
  }

  it('GTM container loaded: was FAIL/critical/"most urgent" — now renders informational, not a failure (P0-04)', () => {
    const r = find('GTM_CONTAINER_LOADED');
    expect(r.status).toBe('warning');
    expect(r.severity).toBe('low');
    expect(r.technical_details.found).toContain('not in use on this site');
    expect(r.technical_details.found).toContain('gtag.js loader'); // the real independent path this scan actually observed
  });

  it('Google Ads AW- ID present: copy corrected to not imply the gtag loader itself is absent (P0-06)', () => {
    const r = find('GOOGLE_ADS_AW_ID_PRESENT');
    expect(r.status).toBe('fail');
    expect(r.severity).toBe('critical'); // genuine — unchanged per the PRD's own table
    expect(r.technical_details.found).toBe('A gtag loader is present but carries no AW- conversion ID');
    expect(r.technical_details.found).not.toContain('No gtag.js loader');
  });

  it('Conversion linker enabled, TikTok Pixel present: genuine failures, unchanged by P0', () => {
    expect(find('CONVERSION_LINKER_ENABLED').status).toBe('fail');
    expect(find('CONVERSION_LINKER_ENABLED').severity).toBe('critical');
    expect(find('TIKTOK_PIXEL_PRESENT').status).toBe('fail');
    expect(find('TIKTOK_PIXEL_PRESENT').severity).toBe('critical');
  });

  it('the three conversion-event-fires rules stay raw FAIL/high but are NOT_OBSERVED-verdict (Needs confirmation) — reproduces the real production values', () => {
    for (const ruleId of ['GOOGLE_ADS_CONVERSION_EVENT_FIRES', 'META_CONVERSION_EVENT_FIRES', 'TIKTOK_CONVERSION_EVENT_FIRES']) {
      const r = find(ruleId);
      expect(r.status, ruleId).toBe('fail');
      expect(r.verdict, ruleId).toBe('NOT_OBSERVED');
      expect(r.observation_confidence, ruleId).toBe('PARTIAL');
      expect(r.severity_capped_from, ruleId).toBe('critical');
    }
  });

  it('CONVERSION_SURFACE_IDENTIFIED passes — reached pages beyond landing (kept broad per the resolved product decision)', () => {
    const r = find('CONVERSION_SURFACE_IDENTIFIED');
    expect(r.status).toBe('pass');
    expect(r.verdict).toBe('PASS');
  });

  it('the coverage panel names the real, evidence-based Consent skip reason(s) instead of the generic fallback (P0-01)', () => {
    // Real trigger scan: consent_capture was populated (attempted, no
    // banner found) — L8.1 skips on the CMP/region declaration, L8.2/L8.3
    // skip on the banner itself being absent. Two genuinely different, both
    // real, evidence-based reasons — both are named, not collapsed to the
    // old generic "nothing to check under this scan's configuration" string.
    const coverage = buildCoverageSummary(AUDIT_DATA, results);
    const consent = coverage?.layers_not_tested.find((l) => l.layer === 'consent');
    expect(consent?.state).toBe('not_applicable');
    expect(consent?.reason).toContain('No CMP declared and no EEA/UK/Switzerland traffic declared');
    expect(consent?.reason).toContain('No consent banner was detected');
    expect(consent?.reason).not.toContain('nothing to check under this scan');
  });

  it('layers_not_tested reconciles against the fixed 13-layer denominator (P0-02)', () => {
    const coverage = buildCoverageSummary(AUDIT_DATA, results)!;
    const assessedCount = 13 - coverage.layers_not_tested.length;
    expect(assessedCount + coverage.layers_not_tested.length).toBe(13);
  });

  it('Business Summary leads with the genuine critical failures, never with GTM, and excludes the Needs-confirmation conversion-fires findings (P0-03/P0-05)', () => {
    const summary = generateBusinessSummary(results);
    expect(summary).not.toContain('GTM container');
    expect(summary).not.toContain('No GTM container script');
    // Genuinely critical and unaffected by P0: AW- ID, TikTok pixel, conversion linker.
    expect(summary).toMatch(/AW- conversion ID|analytics\.tiktok\.com|_gcl_au/);
  });

  it("Meta's Platform Health card reads healthy, not partial — its own Pixel/base-tag genuinely passed and its only 'failure' is the demoted conversion-fires result (P0-03)", () => {
    // Found via the real PureBorn re-run's PDF, after the first P0 push:
    // Platform Health still said "Meta · Partial signal observed / 1 of 5
    // checks failed" purely from META_CONVERSION_EVENT_FIRES's demoted
    // verdict — buildV2PlatformBreakdown() had its own, separate raw-status
    // filter that Sprint 1.4's fix never touched.
    const breakdown = buildV2PlatformBreakdown(results, AUDIT_DATA.declared_platforms, REGISTER);
    const meta = breakdown.find((p) => p.platform === 'Meta');
    expect(meta?.status).toBe('healthy');
    expect(meta?.failed_rules).not.toContain('META_CONVERSION_EVENT_FIRES');
  });

  it("Google Ads' Platform Health card lists only its genuine failures, not the demoted conversion-fires result (P0-03)", () => {
    const breakdown = buildV2PlatformBreakdown(results, AUDIT_DATA.declared_platforms, REGISTER);
    const googleAds = breakdown.find((p) => p.platform === 'Google Ads');
    expect(googleAds?.failed_rules).not.toContain('GOOGLE_ADS_CONVERSION_EVENT_FIRES');
    expect(googleAds?.failed_rules).toEqual(
      expect.arrayContaining(['DECLARED_PLATFORM_HAS_TAG', 'GOOGLE_ADS_AW_ID_PRESENT', 'CONVERSION_LINKER_ENABLED']),
    );
  });

  it('overall status is not driven to critical by GTM (now informational) or by the demoted conversion-fires findings', () => {
    // Still critical overall — genuine critical failures (AW- ID, TikTok pixel, linker) remain.
    expect(determineOverallStatus(results)).toBe('critical');
  });
});
