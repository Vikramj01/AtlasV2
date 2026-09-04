/**
 * Regression coverage for PRD "Signal Health Report" Issue 4's third
 * acceptance criterion: a pre-render guard that catches literal
 * placeholder-shaped text before a report ships. Not a fix for a
 * currently-reproducing bug (that's toSummaryInput/interpretResults, see
 * interpretation/__tests__/engine.test.ts) — this is the defense-in-depth
 * net for a future rule's copy making the same mistake.
 */
import { describe, it, expect } from 'vitest';
import { scanReportForPlaceholders } from '../placeholderGuard';
import { generateReport } from '../generator';
import type { ReportJSON, ReportIssue, ValidationResult, AuditData, SiteSetupSummary, AuditScores } from '@/types/audit';

function makeReport(overrides: Partial<ReportJSON> = {}): ReportJSON {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    generated_at: new Date().toISOString(),
    executive_summary: {
      overall_status: 'healthy',
      business_summary: 'All conversion signals are operating normally.',
      scores: {
        conversion_signal_health: 100,
        attribution_risk_level: 'Low',
        optimization_strength: 'Strong',
        data_consistency_score: 'High',
      },
    },
    journey_stages: [],
    platform_breakdown: [],
    issues: [],
    site_setup: {} as SiteSetupSummary,
    technical_appendix: { validation_results: [], raw_network_requests: [], raw_datalayer_events: [] },
    ...overrides,
  };
}

function makeIssue(overrides: Partial<ReportIssue> = {}): ReportIssue {
  return {
    rule_id: 'SOME_RULE',
    severity: 'medium',
    problem: 'A problem occurred.',
    why_it_matters: 'It matters because of this.',
    fix_summary: 'Fix it this way.',
    recommended_owner: 'Frontend Developer',
    estimated_effort: 'low',
    ...overrides,
  };
}

describe('scanReportForPlaceholders', () => {
  it('finds nothing in a clean report', () => {
    expect(scanReportForPlaceholders(makeReport())).toEqual([]);
  });

  it('flags an unfilled G-XXXXXXXXXX placeholder in the business summary', () => {
    const report = makeReport({
      executive_summary: {
        overall_status: 'critical',
        business_summary: 'GA4 config fires and a measurement ID (G-XXXXXXXXXX) resolves.',
        scores: makeReport().executive_summary.scores,
      },
    });
    const flags = scanReportForPlaceholders(report);
    expect(flags).toHaveLength(1);
    expect(flags[0].field).toBe('executive_summary.business_summary');
    expect(flags[0].matches[0]).toContain('G-XXXXXXXXXX');
  });

  it('flags an unresolved {{template}} variable in an issue field', () => {
    const report = makeReport({
      issues: [makeIssue({ why_it_matters: 'The {{platform_name}} tag is missing.' })],
    });
    const flags = scanReportForPlaceholders(report);
    expect(flags).toHaveLength(1);
    expect(flags[0].field).toBe('issues[0].why_it_matters (SOME_RULE)');
  });

  it('flags placeholder text in a journey_stages issue label', () => {
    const report = makeReport({
      journey_stages: [{ stage: 'L1 · Foundation', status: 'fail', issues: [{ rule_id: 'X', label: 'ID is AW-XXXXXXXXX' }] }],
    });
    const flags = scanReportForPlaceholders(report);
    expect(flags).toHaveLength(1);
    expect(flags[0].field).toContain('journey_stages[0].issues[0]');
  });

  it('flags placeholder text in a platform_breakdown risk_explanation and failed_rule_details', () => {
    const report = makeReport({
      platform_breakdown: [{
        platform: 'Google Ads',
        status: 'broken',
        risk_explanation: 'Conversion ID XXXXXXXX is not configured.',
        failed_rules: ['X'],
        failed_rule_details: [{ rule_id: 'X', impact: 'Uses {{missing}} value.' }],
      }],
    });
    const flags = scanReportForPlaceholders(report);
    expect(flags).toHaveLength(2);
  });

  it('does not flag real evidence that happens to contain a run of capital letters (a malformed hash)', () => {
    const report = makeReport({
      issues: [makeIssue({ why_it_matters: 'Hash "ABCD1234" is not a 64-char lowercase hex string.' })],
    });
    // "ABCD1234" is mixed-case/short and not a 4+ run of literal X's — should not trip the guard.
    expect(scanReportForPlaceholders(report)).toEqual([]);
  });
});

describe('generateReport — content_quality_warning wiring', () => {
  const auditData: AuditData = {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
  };
  const scores: AuditScores = {
    conversion_signal_health: 0,
    attribution_risk_level: 'Critical',
    optimization_strength: 'Weak',
    data_consistency_score: 'Low',
  };
  const siteSetup = {} as SiteSetupSummary;

  it('leaves content_quality_warning unset when nothing is flagged', () => {
    const results: ValidationResult[] = [];
    const report = generateReport(auditData, scores, [], results, siteSetup);
    expect(report.content_quality_warning).toBeUndefined();
  });

  it('sets content_quality_warning when an issue carries placeholder-shaped text', () => {
    const issues: ReportIssue[] = [makeIssue({ fix_summary: 'Use ID G-XXXXXXXXXX to configure this.' })];
    const report = generateReport(auditData, scores, issues, [], siteSetup);
    expect(report.content_quality_warning).toBeDefined();
    expect(report.content_quality_warning!.flagged_fields.length).toBeGreaterThan(0);
    expect(report.content_quality_warning!.flagged_fields[0]).toContain('fix_summary');
  });
});
