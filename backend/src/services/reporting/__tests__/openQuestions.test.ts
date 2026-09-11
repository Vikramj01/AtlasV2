/**
 * buildOpenQuestions (Report Honesty PRD Part B) tests — the two sources
 * feeding ReportJSON.open_questions: rule-authored client_question results,
 * and the bespoke unverified-conversion-surface question (§B2/W5).
 */
import { describe, it, expect } from 'vitest';
import { buildOpenQuestions } from '../openQuestions';
import { DECLARED_PLATFORM_HAS_TAG } from '@/services/validation/register/L0';
import type { AuditData, StepCoverage, UnassessableFinding, ValidationResult } from '@/types/audit';

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

// Pre-Connection Scan Confidence Tiering PRD §11.3 — extends the mechanism
// to CONFLICT-kind could_not_be_assessed entries and non-CLIENT_CONFIRMED
// DERIVED findings (§8).

describe('buildOpenQuestions — CONFLICT-kind findings (PRD §11.3)', () => {
  function makeFinding(overrides: Partial<UnassessableFinding> = {}): UnassessableFinding {
    return { rule_id: 'GA4_CONFIG_TAG_PRESENT', step: 'landing', reason: 'Signals disagree on GA4.', kind: 'CONFLICT', ...overrides };
  }

  it('emits a question built from a CONFLICT-kind finding\'s own reason text', () => {
    const finding = makeFinding({ reason: 'Signals disagree on GA4 — DL reports: gtag(\'config\', \'G-XXXX\') observed. NET reports: no collect request found.' });
    const questions = buildOpenQuestions(makeAuditData(), [], [finding]);
    expect(questions).toHaveLength(1);
    expect(questions?.[0]).toContain('Signals disagree on GA4');
    expect(questions?.[0]).toMatch(/which reading is accurate/i);
  });

  it('emits one question per CONFLICT-kind finding, in order', () => {
    const findings = [makeFinding({ rule_id: 'A', reason: 'Reason A.' }), makeFinding({ rule_id: 'B', reason: 'Reason B.' })];
    const questions = buildOpenQuestions(makeAuditData(), [], findings);
    expect(questions).toHaveLength(2);
    expect(questions?.[0]).toContain('Reason A.');
    expect(questions?.[1]).toContain('Reason B.');
  });

  it('does not emit a question for a NOT_OBSERVED-kind finding (a crawl limitation, not something the client can answer)', () => {
    const finding = makeFinding({ kind: 'NOT_OBSERVED', reason: 'The scan could not reach this step.' });
    expect(buildOpenQuestions(makeAuditData(), [], [finding])).toBeUndefined();
  });

  it('does not emit a question for a finding with no kind set', () => {
    const finding = makeFinding({ kind: undefined });
    expect(buildOpenQuestions(makeAuditData(), [], [finding])).toBeUndefined();
  });

  it('defaults to no unassessable findings when the parameter is omitted', () => {
    expect(buildOpenQuestions(makeAuditData(), [])).toBeUndefined();
  });
});

describe('buildOpenQuestions — DECLARED_PLATFORM_HAS_TAG (non-CLIENT_CONFIRMED DERIVED finding, PRD §8/§11.3)', () => {
  it('asks a question when the declaration was not CLIENT_CONFIRMED (severity capped)', () => {
    const auditData = makeAuditData({ declared_platforms: ['meta'], declaration_source: 'OPERATOR_ASSUMED' });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.severity_capped_from).toBeDefined();
    const questions = buildOpenQuestions(makeAuditData(), [result]);
    expect(questions).toHaveLength(1);
    expect(questions?.[0]).toContain('Meta');
  });

  it('does not ask a question when the declaration was CLIENT_CONFIRMED (a real defect, not an open question)', () => {
    const auditData = makeAuditData({ declared_platforms: ['meta'], declaration_source: 'CLIENT_CONFIRMED' });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.severity_capped_from).toBeUndefined();
    expect(buildOpenQuestions(makeAuditData(), [result])).toBeUndefined();
  });

  it('does not ask a question when the platform is present (nothing capped, nothing to ask)', () => {
    const auditData = makeAuditData({
      declared_platforms: ['meta'],
      declaration_source: 'OPERATOR_ASSUMED',
      networkRequests: [{ url: 'https://facebook.com/tr?id=123', method: 'GET', headers: {}, timestamp: Date.now(), step: 'landing' }],
    });
    const result = DECLARED_PLATFORM_HAS_TAG.test(auditData);
    expect(result.status).toBe('pass');
    expect(buildOpenQuestions(makeAuditData(), [result])).toBeUndefined();
  });
});
