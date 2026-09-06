/**
 * buildOpenQuestions (Report Honesty PRD Part B) tests — the two sources
 * feeding ReportJSON.open_questions: rule-authored client_question results,
 * and the bespoke unverified-conversion-surface question (§B2/W5).
 */
import { describe, it, expect } from 'vitest';
import { buildOpenQuestions } from '../openQuestions';
import type { AuditData, StepCoverage, ValidationResult } from '@/types/audit';

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

function makeStep(overrides: Partial<StepCoverage> = {}): StepCoverage {
  return {
    step: 'checkout',
    requested_url: 'https://example.com/checkout',
    source: 'user_supplied',
    distinct_from_landing: true,
    navigation_success: true,
    ...overrides,
  };
}

describe('buildOpenQuestions', () => {
  it('returns undefined when there is nothing to ask — the section is omitted, not an empty array', () => {
    expect(buildOpenQuestions(makeAuditData(), [])).toBeUndefined();
  });

  it('collects a rule-authored client_question from a real v2 failing result', () => {
    const result: ValidationResult = {
      rule_id: 'UNDECLARED_PLATFORM_TAG_DETECTED',
      validation_layer: 'scope_configuration',
      status: 'warning',
      severity: 'low',
      technical_details: {
        found: '1 undeclared platform tag detected: Microsoft UET',
        expected: 'Only declared platforms have tags firing on the site',
        evidence: ['Microsoft UET: tag detected but not declared — legacy/rogue tag, or an undeclared channel worth asking about'],
      },
    };
    const questions = buildOpenQuestions(makeAuditData(), [result]);
    expect(questions).toHaveLength(1);
    expect(questions?.[0]).toContain('Microsoft UET');
  });

  it("emits the bespoke unverified-conversion-surface question when the reached step's provenance is 'heuristic'", () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic' })],
    });
    const questions = buildOpenQuestions(auditData, []);
    expect(questions).toHaveLength(1);
    expect(questions?.[0]).toMatch(/could not confirm your order confirmation page/i);
  });

  it('does not emit the unverified-conversion-surface question for a user-supplied or sitemap-found step', () => {
    const userSupplied = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'user_supplied' })],
    });
    expect(buildOpenQuestions(userSupplied, [])).toBeUndefined();

    const viaSitemap = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'sitemap' })],
    });
    expect(buildOpenQuestions(viaSitemap, [])).toBeUndefined();
  });

  it('does not emit the unverified-conversion-surface question when the crawl never reached a conversion surface at all', () => {
    const homepageOnly = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })],
    });
    expect(buildOpenQuestions(homepageOnly, [])).toBeUndefined();
  });

  it('combines both sources and preserves result order for the client_question half', () => {
    const results: ValidationResult[] = [
      {
        rule_id: 'UNDECLARED_PLATFORM_TAG_DETECTED',
        validation_layer: 'scope_configuration',
        status: 'warning',
        severity: 'low',
        technical_details: { found: '', expected: '', evidence: [] },
      },
    ];
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic' })],
    });
    const questions = buildOpenQuestions(auditData, results);
    expect(questions).toHaveLength(2);
    expect(questions?.[1]).toMatch(/could not confirm your order confirmation page/i);
  });
});
