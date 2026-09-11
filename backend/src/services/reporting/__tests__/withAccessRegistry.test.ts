/**
 * With-access registry tests (Pre-Connection Scan Confidence Tiering PRD
 * §12). Every registry entry must resolve a real finding/question raised
 * in this run (§12.1) — nothing renders when nothing applies.
 */
import { describe, it, expect } from 'vitest';
import { buildWithAccessSection } from '../withAccessRegistry';
import type { ReportJSON, ReportIssue, SiteSetupSummary, UnassessableFinding } from '@/types/audit';

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
    validation_layer: 'scope_configuration',
    severity: 'medium',
    problem: 'A problem occurred.',
    why_it_matters: 'It matters.',
    fix_summary: 'Fix it.',
    recommended_owner: 'Marketing Ops',
    estimated_effort: 'low',
    ...overrides,
  };
}

describe('buildWithAccessSection', () => {
  it('returns undefined when nothing in the registry resolves anything this run raised', () => {
    expect(buildWithAccessSection(makeReport())).toBeUndefined();
  });

  it('returns undefined for an issue whose rule_id matches no registry entry', () => {
    const report = makeReport({ issues: [makeIssue({ rule_id: 'SOME_UNRELATED_RULE' })] });
    expect(buildWithAccessSection(report)).toBeUndefined();
  });

  it('includes Platform reconciliation when DECLARED_PLATFORM_HAS_TAG is an issue this run', () => {
    const report = makeReport({ issues: [makeIssue({ rule_id: 'DECLARED_PLATFORM_HAS_TAG' })] });
    const section = buildWithAccessSection(report);
    expect(section).toHaveLength(1);
    expect(section?.[0].check).toBe('Platform reconciliation');
    expect(section?.[0].answers_question_for).toEqual(['DECLARED_PLATFORM_HAS_TAG']);
  });

  it('picks up a rule_id from could_not_be_assessed, not just issues', () => {
    const finding: UnassessableFinding = { rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW', step: 'landing', reason: 'x' };
    const report = makeReport({ could_not_be_assessed: [finding] });
    const section = buildWithAccessSection(report);
    expect(section).toHaveLength(1);
    expect(section?.[0].check).toBe('Attribution window integrity');
  });

  it('narrows answers_question_for to only the rule_ids actually raised this run, never over-claiming', () => {
    // Platform reconciliation's registry entry names two rule_ids; only one is raised here.
    const report = makeReport({ issues: [makeIssue({ rule_id: 'DECLARED_PLATFORM_HAS_TAG' })] });
    const section = buildWithAccessSection(report);
    expect(section?.[0].answers_question_for).toEqual(['DECLARED_PLATFORM_HAS_TAG']);
    expect(section?.[0].answers_question_for).not.toContain('UNDECLARED_PLATFORM_TAG_DETECTED');
  });

  it('includes multiple entries when multiple registry-mapped rule_ids are raised', () => {
    const report = makeReport({
      issues: [
        makeIssue({ rule_id: 'DECLARED_PLATFORM_HAS_TAG' }),
        makeIssue({ rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW' }),
      ],
    });
    const section = buildWithAccessSection(report);
    expect(section?.map((e) => e.check).sort()).toEqual(['Attribution window integrity', 'Platform reconciliation']);
  });

  it('every entry declares requires_connection and a one-line reveals', () => {
    const report = makeReport({ issues: [makeIssue({ rule_id: 'DECLARED_PLATFORM_HAS_TAG' })] });
    const section = buildWithAccessSection(report);
    expect(section?.[0].requires_connection.length).toBeGreaterThan(0);
    expect(section?.[0].reveals.length).toBeGreaterThan(0);
  });
});
