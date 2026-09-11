/**
 * Pre-Connection Scan Confidence Tiering PRD §5 — output vocabulary
 * binding. Covers lintReportOutput/assertReportOutputClean's field-walk and
 * generateReport()'s wiring of the hard gate (v2 only).
 */
import { describe, it, expect } from 'vitest';
import { lintReportOutput, assertReportOutputClean, OutputLintError } from '../outputLint';
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
    validation_layer: 'foundation_tags',
    severity: 'medium',
    problem: 'A problem occurred.',
    why_it_matters: 'It matters because of this.',
    fix_summary: 'Fix it this way.',
    recommended_owner: 'Frontend Developer',
    estimated_effort: 'low',
    ...overrides,
  };
}

function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    rule_id: 'SOME_RULE',
    validation_layer: 'foundation_tags',
    status: 'fail',
    severity: 'medium',
    technical_details: { found: 'Something happened.', expected: 'Something else should happen.', evidence: ['Some evidence line.'] },
    ...overrides,
  };
}

describe('lintReportOutput', () => {
  it('finds nothing in a clean report', () => {
    expect(lintReportOutput(makeReport())).toEqual([]);
  });

  it('flags a banned token in the business summary', () => {
    const report = makeReport({
      executive_summary: {
        overall_status: 'critical',
        business_summary: 'The GA4 tag is Not Detected on this page.',
        scores: makeReport().executive_summary.scores,
      },
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('executive_summary.business_summary');
    expect(violations[0].token).toBe('Not Detected');
  });

  it('flags a banned token regardless of casing', () => {
    const report = makeReport({
      executive_summary: {
        overall_status: 'critical',
        business_summary: 'The Meta pixel is BROKEN on the checkout page.',
        scores: makeReport().executive_summary.scores,
      },
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(1);
    expect(violations[0].token).toBe('Broken');
  });

  it('flags a banned token in issues[].problem and why_it_matters, but not in fix_summary', () => {
    const report = makeReport({
      issues: [makeIssue({ problem: 'gclid is missing from the URL.', why_it_matters: 'You have no attribution without it.', fix_summary: 'Fix the missing param by reading it on landing.' })],
    });
    const violations = lintReportOutput(report);
    const fields = violations.map((v) => v.field);
    expect(fields).toContain('issues[0].problem (SOME_RULE)');
    expect(fields).toContain('issues[0].why_it_matters (SOME_RULE)');
    expect(fields.some((f) => f.includes('fix_summary'))).toBe(false);
  });

  it('flags a banned token in a journey_stages issue label', () => {
    const report = makeReport({
      journey_stages: [{ stage: 'L1 · Foundation', status: 'fail', issues: [{ rule_id: 'X', label: 'GTM container missing' }] }],
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toContain('journey_stages[0].issues[0].label');
  });

  it('flags a banned token in platform_breakdown risk_explanation and failed_rule_details.impact', () => {
    const report = makeReport({
      platform_breakdown: [{
        platform: 'Google Ads',
        status: 'broken',
        risk_explanation: 'The conversion tag is not installed.',
        failed_rules: ['X'],
        failed_rule_details: [{ rule_id: 'X', impact: 'Zero measurement on this platform.' }],
      }],
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(2);
  });

  it('does NOT flag platform_breakdown[].status itself, even when it is the literal string "broken"', () => {
    const report = makeReport({
      platform_breakdown: [{
        platform: 'Meta',
        status: 'broken',
        risk_explanation: 'Most checks failed for this platform.',
        failed_rules: [],
        failed_rule_details: [],
      }],
    });
    expect(lintReportOutput(report)).toEqual([]);
  });

  it('flags a banned token in technical_appendix.validation_results found/expected/evidence', () => {
    const report = makeReport({
      technical_appendix: {
        validation_results: [
          makeValidationResult({
            technical_details: {
              found: 'Tag is Not Detected on the landing page.',
              expected: 'you have no reason to expect this passes',
              evidence: ['fbp cookie: missing'],
            },
          }),
        ],
        raw_network_requests: [],
        raw_datalayer_events: [],
      },
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.field)).toEqual([
      'technical_appendix.validation_results[0] (SOME_RULE).technical_details.found',
      'technical_appendix.validation_results[0] (SOME_RULE).technical_details.expected',
      'technical_appendix.validation_results[0] (SOME_RULE).technical_details.evidence[0]',
    ]);
  });

  it('flags a banned token in could_not_be_assessed[].reason', () => {
    const report = makeReport({
      could_not_be_assessed: [{ rule_id: 'X', step: 'landing', reason: 'The signal is broken for this step.' }],
    });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toContain('could_not_be_assessed[0].reason');
  });

  it('flags a banned token in open_questions[]', () => {
    const report = makeReport({ open_questions: ['Is the second GTM container missing intentionally, or a mistake?'] });
    const violations = lintReportOutput(report);
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('open_questions[0]');
  });

  it('does not flag real evidence containing an unrelated run of capital letters', () => {
    const report = makeReport({
      issues: [makeIssue({ why_it_matters: 'Hash "ABCD1234" is not a 64-char lowercase hex string.' })],
    });
    expect(lintReportOutput(report)).toEqual([]);
  });
});

describe('assertReportOutputClean', () => {
  it('does not throw for a clean report', () => {
    expect(() => assertReportOutputClean(makeReport())).not.toThrow();
  });

  it('throws OutputLintError with every violation attached when the report is dirty', () => {
    const report = makeReport({
      issues: [makeIssue({ problem: 'The pixel is Broken.' })],
      open_questions: ['Is the tag missing on purpose?'],
    });
    try {
      assertReportOutputClean(report);
      expect.unreachable('expected assertReportOutputClean to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OutputLintError);
      expect((err as OutputLintError).violations).toHaveLength(2);
    }
  });
});

describe('generateReport — output vocabulary lint wiring (v2 only)', () => {
  const baseAuditData: AuditData = {
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

  it('does not throw for a clean v2 report', () => {
    const auditData: AuditData = { ...baseAuditData, rule_set_version: 'v2' };
    expect(() => generateReport(auditData, scores, [], [], siteSetup)).not.toThrow();
  });

  it('throws when a v2 report carries a banned-token issue', () => {
    const auditData: AuditData = { ...baseAuditData, rule_set_version: 'v2' };
    const issues: ReportIssue[] = [makeIssue({ problem: 'The gclid parameter is missing.' })];
    expect(() => generateReport(auditData, scores, issues, [], siteSetup)).toThrow(OutputLintError);
  });

  it('does NOT gate a v1-legacy report, even with the same banned-token content', () => {
    const auditData: AuditData = { ...baseAuditData, rule_set_version: 'v1-legacy' };
    const issues: ReportIssue[] = [makeIssue({ problem: 'The gclid parameter is missing.' })];
    expect(() => generateReport(auditData, scores, issues, [], siteSetup)).not.toThrow();
  });

  it('does NOT gate a report with no rule_set_version set (pre-existing v1 rows)', () => {
    const issues: ReportIssue[] = [makeIssue({ problem: 'The gclid parameter is missing.' })];
    expect(() => generateReport(baseAuditData, scores, issues, [], siteSetup)).not.toThrow();
  });
});
