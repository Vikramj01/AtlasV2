/**
 * End-to-end verification of the v2 report-generation pipeline (Task 15):
 * runRegister → calculateV2Scores → buildV2LayerStages/
 * buildV2PlatformBreakdown → generateReport, run together against one
 * realistic AuditData — the same wiring orchestrator.ts uses for a v2
 * audit, minus the DB/Browserbase I/O around it.
 */
import { describe, it, expect } from 'vitest';
import { runRegister } from '@/services/validation/register/engine';
import { calculateV2Scores } from '@/services/validation/register/scoring';
import { buildV2LayerStages, buildV2PlatformBreakdown } from '@/services/validation/register/reporting';
import { interpretResults } from '@/services/interpretation/engine';
import { generateReport } from '../generator';
import { buildSiteSetupSummary } from '@/services/audit/siteSetupDetector';
import type { AuditData, DataLayerEvent, NetworkRequest } from '@/types/audit';

function makeEvent(overrides: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { event: 'sign_up', timestamp: Date.now(), step: 'confirmation', ...overrides };
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

/** A PLG SaaS site with only Google Ads declared and a handful of things implemented, several not — a realistic partial state, not a perfect or empty fixture. */
function makePartiallyInstrumentedAuditData(): AuditData {
  return {
    audit_id: 'audit-v2-pipeline',
    website_url: 'https://app.example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: ['google_ads'],
    declared_conversions: [{ name: 'sign_up', kind: 'primary' }],
    steps_visited: ['init', 'landing', 'pricing', 'confirmation'],
    urlParams: { gclid: 'test_gclid_1' },
    cookies: {},
    dataLayer: [
      makeEvent({ event: 'page_view', step: 'landing' }),
      makeEvent({ event: 'page_view', step: 'pricing' }),
      makeEvent({ event: 'sign_up', step: 'confirmation' }), // no value/currency/transaction_id — several L6 rules should fail
    ],
    networkRequests: [
      makeRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-XYZ789', step: 'landing' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-DEF&en=page_view&cid=9.9', step: 'landing' }),
      makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-DEF&en=sign_up&cid=9.9', step: 'confirmation' }),
      // No googleadservices.com conversion hit — Google Ads conversion never fires, despite being declared.
    ],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: 'test_gclid_1', fbclid: '' },
    pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-XYZ789'] },
  };
}

describe('v2 report-generation pipeline', () => {
  const auditData = makePartiallyInstrumentedAuditData();

  it('runs end-to-end without throwing at any stage', () => {
    expect(() => {
      const validationResults = runRegister(auditData);
      const scores = calculateV2Scores(validationResults);
      const issues = interpretResults(validationResults);
      const customJourneyStages = buildV2LayerStages(validationResults);
      const customPlatformBreakdown = buildV2PlatformBreakdown(validationResults, auditData.declared_platforms);
      const siteSetup = buildSiteSetupSummary(auditData, ['https://www.googletagmanager.com/gtm.js?id=GTM-XYZ789'], null);
      generateReport(auditData, scores, issues, validationResults, siteSetup, customJourneyStages, customPlatformBreakdown);
    }).not.toThrow();
  });

  it('produces a report that reflects the mixed pass/fail state — not fully healthy, not fully broken', () => {
    const validationResults = runRegister(auditData);
    const scores = calculateV2Scores(validationResults);
    const issues = interpretResults(validationResults);
    const customJourneyStages = buildV2LayerStages(validationResults);
    const customPlatformBreakdown = buildV2PlatformBreakdown(validationResults, auditData.declared_platforms);
    const siteSetup = buildSiteSetupSummary(auditData, ['https://www.googletagmanager.com/gtm.js?id=GTM-XYZ789'], null);
    const report = generateReport(auditData, scores, issues, validationResults, siteSetup, customJourneyStages, customPlatformBreakdown);

    // Foundation is working — GTM and GA4 both loaded and fired. (L1 as a
    // whole still reports 'fail' because it also covers the never-configured
    // server-container endpoint (L1.14) — buildV2LayerStages marks a layer
    // 'fail' if any rule in it fails, so we check the individual rules that
    // matter here rather than the aggregate layer status.)
    expect(validationResults.find((r) => r.rule_id === 'GTM_CONTAINER_LOADED')?.status).toBe('pass');
    expect(validationResults.find((r) => r.rule_id === 'GA4_CONFIG_TAG_PRESENT')?.status).toBe('pass');

    // Google Ads was declared but its conversion never fires — Attribution-ish layers should show real failures.
    expect(report.executive_summary.overall_status).not.toBe('healthy');
    expect(report.executive_summary.business_summary).not.toBe('All conversion signals are operating normally.');

    const googleAds = report.platform_breakdown.find((p) => p.platform === 'Google Ads');
    expect(googleAds?.status).not.toBe('not_included'); // it WAS declared and had applicable rules
    expect(googleAds?.failed_rules.length).toBeGreaterThan(0);

    // Undeclared platforms correctly show as out of scope, not broken.
    const meta = report.platform_breakdown.find((p) => p.platform === 'Meta');
    expect(meta?.status).toBe('not_included');

    // rule_set_version travels through onto the report.
    expect(report.rule_set_version).toBe('v2');

    // Every issue surfaced traces back to a real result, and nothing crashed rendering business copy.
    expect(issues.every((i) => typeof i.why_it_matters === 'string' && i.why_it_matters.length > 0)).toBe(true);
  });
});
