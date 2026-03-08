/**
 * Report Generator Tests
 * Validates ReportJSON structure, journey stage mapping, platform breakdown,
 * and integration with the interpretation engine.
 */
import { describe, it, expect } from 'vitest';
import { generateReport } from '../generator';
import { calculateScores } from '@/services/scoring/engine';
import type { ValidationResult, AuditScores, ReportIssue, AuditData } from '@/types/audit';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(
  rule_id: string,
  status: 'pass' | 'fail' | 'warning' = 'pass',
  layer: 'signal_initiation' | 'parameter_completeness' | 'persistence' = 'parameter_completeness',
): ValidationResult {
  return {
    rule_id,
    validation_layer: layer,
    status,
    severity: 'high',
    technical_details: { found: 'found-val', expected: 'expected-val', evidence: [] },
  };
}

function makeScores(overrides?: Partial<AuditScores>): AuditScores {
  return {
    conversion_signal_health: 80,
    attribution_risk_level: 'Low',
    optimization_strength: 'Strong',
    data_consistency_score: 'High',
    ...overrides,
  };
}

function makeAuditData(overrides?: Partial<AuditData>): AuditData {
  return {
    audit_id: 'audit-test-001',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    urlParams: {},
    storage: {},
    cookies: {},
    pageMetadata: {},
    ...overrides,
  };
}

function makeIssue(rule_id: string): ReportIssue {
  return {
    rule_id,
    severity: 'high',
    problem: `${rule_id} is broken`,
    fix_summary: `Fix ${rule_id}`,
    recommended_owner: 'Frontend Developer',
    estimated_effort: 'medium',
    affected_platforms: ['ga4'],
  };
}

// ── Top-level structure ────────────────────────────────────────────────────────

describe('generateReport — top-level structure', () => {
  it('returns all required top-level keys', () => {
    const report = generateReport(makeAuditData(), makeScores(), [], []);
    expect(report).toHaveProperty('audit_id', 'audit-test-001');
    expect(report).toHaveProperty('generated_at');
    expect(report).toHaveProperty('executive_summary');
    expect(report).toHaveProperty('journey_stages');
    expect(report).toHaveProperty('platform_breakdown');
    expect(report).toHaveProperty('issues');
    expect(report).toHaveProperty('technical_appendix');
  });

  it('generated_at is a valid ISO 8601 string', () => {
    const { generated_at } = generateReport(makeAuditData(), makeScores(), [], []);
    expect(() => new Date(generated_at)).not.toThrow();
    expect(new Date(generated_at).toISOString()).toBe(generated_at);
  });

  it('passes issues through unchanged', () => {
    const issues = [makeIssue('GA4_PURCHASE_EVENT_FIRED'), makeIssue('TRANSACTION_ID_PRESENT')];
    const { issues: out } = generateReport(makeAuditData(), makeScores(), issues, []);
    expect(out).toHaveLength(2);
    expect(out[0].rule_id).toBe('GA4_PURCHASE_EVENT_FIRED');
  });

  it('includes raw network requests and dataLayer in technical appendix', () => {
    const auditData = makeAuditData({
      networkRequests: [{ url: 'https://analytics.google.com/g/collect', method: 'POST', headers: {}, timestamp: 1, step: 'confirmation' }],
      dataLayer: [{ event: 'purchase', timestamp: 1, step: 'confirmation' }],
    });
    const report = generateReport(auditData, makeScores(), [], []);
    expect(report.technical_appendix.raw_network_requests).toHaveLength(1);
    expect(report.technical_appendix.raw_datalayer_events).toHaveLength(1);
    expect(report.technical_appendix.validation_results).toEqual([]);
  });

  it('stores passed validation_results in technical_appendix', () => {
    const results = [makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass')];
    const report = generateReport(makeAuditData(), makeScores(), [], results);
    expect(report.technical_appendix.validation_results).toHaveLength(1);
    expect(report.technical_appendix.validation_results[0].rule_id).toBe('GA4_PURCHASE_EVENT_FIRED');
  });
});

// ── Executive Summary ──────────────────────────────────────────────────────────

describe('generateReport — executive summary', () => {
  it('passes scores through to executive_summary', () => {
    const scores = makeScores({ conversion_signal_health: 42, attribution_risk_level: 'High' });
    const { executive_summary } = generateReport(makeAuditData(), scores, [], []);
    expect(executive_summary.scores.conversion_signal_health).toBe(42);
    expect(executive_summary.scores.attribution_risk_level).toBe('High');
  });

  it('overall_status is "healthy" when no rules fail', () => {
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
    ];
    const { executive_summary } = generateReport(makeAuditData(), makeScores(), [], results);
    expect(executive_summary.overall_status).toBe('healthy');
  });

  it('overall_status is "critical" when critical rules fail', () => {
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail'),
      makeResult('GTM_CONTAINER_LOADED', 'fail'),
      makeResult('DATALAYER_POPULATED', 'fail'),
    ];
    const { executive_summary } = generateReport(makeAuditData(), makeScores(), [], results);
    expect(['critical', 'partially_broken']).toContain(executive_summary.overall_status);
  });

  it('business_summary is a non-empty string', () => {
    const { executive_summary } = generateReport(makeAuditData(), makeScores(), [], []);
    expect(typeof executive_summary.business_summary).toBe('string');
    expect(executive_summary.business_summary.length).toBeGreaterThan(0);
  });
});

// ── Journey Stages ─────────────────────────────────────────────────────────────

describe('generateReport — journey stages', () => {
  it('generates 5 stages for ecommerce funnel', () => {
    const { journey_stages } = generateReport(makeAuditData({ funnel_type: 'ecommerce' }), makeScores(), [], []);
    expect(journey_stages).toHaveLength(5);
    const names = journey_stages.map((s) => s.stage);
    expect(names).toContain('Landing');
    expect(names).toContain('Confirmation');
    expect(names).toContain('Platforms');
  });

  it('generates 5 stages for saas funnel', () => {
    const { journey_stages } = generateReport(makeAuditData({ funnel_type: 'saas' }), makeScores(), [], []);
    expect(journey_stages).toHaveLength(5);
    const names = journey_stages.map((s) => s.stage);
    expect(names).toContain('Onboarding');
    expect(names).toContain('Signup');
  });

  it('generates 4 stages for lead_gen funnel', () => {
    const { journey_stages } = generateReport(makeAuditData({ funnel_type: 'lead_gen' }), makeScores(), [], []);
    expect(journey_stages).toHaveLength(4);
    const names = journey_stages.map((s) => s.stage);
    expect(names).toContain('Form');
    expect(names).toContain('Thank You');
  });

  it('unknown funnel type falls back to ecommerce stages', () => {
    const auditData = makeAuditData({ funnel_type: 'unknown_type' as 'ecommerce' });
    const { journey_stages } = generateReport(auditData, makeScores(), [], []);
    expect(journey_stages).toHaveLength(5);
  });

  it('stage status is "fail" when a stage rule fails', () => {
    // GTM_CONTAINER_LOADED is a Landing stage rule
    const results = [makeResult('GTM_CONTAINER_LOADED', 'fail', 'signal_initiation')];
    const { journey_stages } = generateReport(makeAuditData(), makeScores(), [], results);
    const landing = journey_stages.find((s) => s.stage === 'Landing');
    expect(landing?.status).toBe('fail');
  });

  it('stage status is "pass" when all its rules pass', () => {
    const results = [
      makeResult('GTM_CONTAINER_LOADED', 'pass', 'signal_initiation'),
      makeResult('PAGE_VIEW_EVENT_FIRED', 'pass', 'signal_initiation'),
      makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('DATALAYER_POPULATED', 'pass', 'signal_initiation'),
    ];
    const { journey_stages } = generateReport(makeAuditData(), makeScores(), [], results);
    const landing = journey_stages.find((s) => s.stage === 'Landing');
    expect(landing?.status).toBe('pass');
  });

  it('stage status is "warning" when a rule warns but none fail', () => {
    const results = [makeResult('GTM_CONTAINER_LOADED', 'warning', 'signal_initiation')];
    const { journey_stages } = generateReport(makeAuditData(), makeScores(), [], results);
    const landing = journey_stages.find((s) => s.stage === 'Landing');
    expect(landing?.status).toBe('warning');
  });

  it('stage issues list contains entry for each failing rule', () => {
    const results = [
      makeResult('GTM_CONTAINER_LOADED', 'fail', 'signal_initiation'),
      makeResult('PAGE_VIEW_EVENT_FIRED', 'fail', 'signal_initiation'),
    ];
    const { journey_stages } = generateReport(makeAuditData(), makeScores(), [], results);
    const landing = journey_stages.find((s) => s.stage === 'Landing');
    expect(landing?.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts custom journey stages via the optional parameter', () => {
    const custom = [{ stage: 'Custom Stage', status: 'pass' as const, issues: [] }];
    const { journey_stages } = generateReport(makeAuditData(), makeScores(), [], [], custom);
    expect(journey_stages).toHaveLength(1);
    expect(journey_stages[0].stage).toBe('Custom Stage');
  });
});

// ── Platform Breakdown ─────────────────────────────────────────────────────────

describe('generateReport — platform breakdown', () => {
  it('returns exactly 5 platforms', () => {
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], []);
    expect(platform_breakdown).toHaveLength(5);
  });

  it('includes google_ads, meta_ads, ga4, gtm, sgtm', () => {
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], []);
    const platforms = platform_breakdown.map((p) => p.platform);
    expect(platforms).toContain('google_ads');
    expect(platforms).toContain('meta_ads');
    expect(platforms).toContain('ga4');
    expect(platforms).toContain('gtm');
    expect(platforms).toContain('sgtm');
  });

  it('platform status is "healthy" when all its rules pass', () => {
    // GTM_CONTAINER_LOADED + DATALAYER_POPULATED are the gtm rules
    const results = [
      makeResult('GTM_CONTAINER_LOADED', 'pass', 'signal_initiation'),
      makeResult('DATALAYER_POPULATED', 'pass', 'signal_initiation'),
    ];
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], results);
    const gtm = platform_breakdown.find((p) => p.platform === 'gtm');
    expect(gtm?.status).toBe('healthy');
    expect(gtm?.failed_rules).toHaveLength(0);
  });

  it('platform status is "broken" when more than half its rules fail', () => {
    // ga4 has 6 rules — fail all 6
    const ga4Rules = [
      'GA4_PURCHASE_EVENT_FIRED', 'DATALAYER_POPULATED', 'GTM_CONTAINER_LOADED',
      'PAGE_VIEW_EVENT_FIRED', 'TRANSACTION_ID_PRESENT', 'ITEMS_ARRAY_POPULATED',
    ];
    const results = ga4Rules.map((id) => makeResult(id, 'fail', 'signal_initiation'));
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], results);
    const ga4 = platform_breakdown.find((p) => p.platform === 'ga4');
    expect(ga4?.status).toBe('broken');
  });

  it('platform status is "at_risk" when up to half its rules fail', () => {
    // ga4 has 6 rules — fail 3 (exactly half)
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'fail', 'signal_initiation'),
      makeResult('DATALAYER_POPULATED', 'fail', 'signal_initiation'),
      makeResult('GTM_CONTAINER_LOADED', 'fail', 'signal_initiation'),
      makeResult('PAGE_VIEW_EVENT_FIRED', 'pass', 'signal_initiation'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
      makeResult('ITEMS_ARRAY_POPULATED', 'pass'),
    ];
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], results);
    const ga4 = platform_breakdown.find((p) => p.platform === 'ga4');
    expect(ga4?.status).toBe('at_risk');
  });

  it('failed_rules lists the rule IDs that failed for the platform', () => {
    const results = [makeResult('GTM_CONTAINER_LOADED', 'fail', 'signal_initiation')];
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], results);
    const gtm = platform_breakdown.find((p) => p.platform === 'gtm');
    expect(gtm?.failed_rules).toContain('GTM_CONTAINER_LOADED');
  });

  it('risk_explanation is a non-empty string for every platform', () => {
    const { platform_breakdown } = generateReport(makeAuditData(), makeScores(), [], []);
    for (const p of platform_breakdown) {
      expect(typeof p.risk_explanation).toBe('string');
      expect(p.risk_explanation.length).toBeGreaterThan(0);
    }
  });
});

// ── Integration with scoring engine ───────────────────────────────────────────

describe('generateReport — integration with scoring engine', () => {
  it('round-trip: scores calculated from results match those in the report', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass', 'signal_initiation'),
    ];
    const scores = calculateScores(results);
    const report = generateReport(makeAuditData(), scores, [], results);
    expect(report.executive_summary.scores).toEqual(scores);
  });
});
