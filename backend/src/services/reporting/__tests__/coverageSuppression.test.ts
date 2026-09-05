/**
 * Coverage suppression tests (Signal Health Report: Evidence Integrity &
 * Presentation PRD §5/W3 — "suppress, do not annotate").
 */
import { describe, it, expect } from 'vitest';
import { partitionCoverageAffected } from '../coverageSuppression';
import type { StepCoverage, ValidationResult } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'hygiene_integrity',
    status: 'fail',
    severity: 'high',
    technical_details: { found: '', expected: '', evidence: [] },
    ...overrides,
  };
}

function makeStep(overrides: Partial<StepCoverage> & { step: string }): StepCoverage {
  return {
    requested_url: 'https://example.com/x',
    source: 'user_supplied',
    distinct_from_landing: true,
    navigation_success: true,
    ...overrides,
  };
}

describe('partitionCoverageAffected', () => {
  it('passes every result through unchanged when step_coverage is undefined', () => {
    const results = [makeResult({ rule_id: 'A' })];
    const { assessable, unassessable } = partitionCoverageAffected(results, undefined);
    expect(assessable).toEqual(results);
    expect(unassessable).toEqual([]);
  });

  it('passes every result through unchanged when no step resolved to fallback_landing', () => {
    const results = [makeResult({ rule_id: 'A', technical_details: { found: 'ok on "checkout"', expected: '', evidence: [] } })];
    const steps = [makeStep({ step: 'checkout', source: 'nav_link' })];
    const { assessable, unassessable } = partitionCoverageAffected(results, steps);
    expect(assessable).toEqual(results);
    expect(unassessable).toEqual([]);
  });

  it('excludes a result whose found text names a fallback_landing step in quotes', () => {
    const result = makeResult({
      rule_id: 'JAVASCRIPT_ERRORS_ON_CONVERSION_SURFACE',
      technical_details: { found: '2 JavaScript error(s) on the conversion surface ("onboarding")', expected: '', evidence: [] },
    });
    const steps = [makeStep({ step: 'onboarding', source: 'fallback_landing' })];
    const { assessable, unassessable } = partitionCoverageAffected([result], steps);
    expect(assessable).toEqual([]);
    expect(unassessable).toHaveLength(1);
    expect(unassessable[0]).toMatchObject({ rule_id: 'JAVASCRIPT_ERRORS_ON_CONVERSION_SURFACE', step: 'onboarding' });
  });

  it('excludes a passing result the same as a failing one — a false pass is still a false finding', () => {
    const result = makeResult({
      rule_id: 'NO_ERRORS',
      status: 'pass',
      technical_details: { found: 'No JavaScript errors on the conversion surface ("onboarding")', expected: '', evidence: [] },
    });
    const steps = [makeStep({ step: 'onboarding', source: 'fallback_landing' })];
    const { assessable, unassessable } = partitionCoverageAffected([result], steps);
    expect(assessable).toEqual([]);
    expect(unassessable).toHaveLength(1);
  });

  it('does not double-flag an already-skipped result even if it happens to quote a fallback step name', () => {
    const result = makeResult({
      rule_id: 'SOME_RULE',
      status: 'skipped',
      technical_details: { found: 'Not tested — the crawl never reached a page distinct from the landing page ("onboarding")', expected: '', evidence: [] },
    });
    const steps = [makeStep({ step: 'onboarding', source: 'fallback_landing' })];
    const { assessable, unassessable } = partitionCoverageAffected([result], steps);
    expect(assessable).toEqual([result]);
    expect(unassessable).toEqual([]);
  });

  it('only excludes results citing the specific fallback step, not every result in the audit', () => {
    const affected = makeResult({
      rule_id: 'AFFECTED',
      technical_details: { found: 'issue on "onboarding"', expected: '', evidence: [] },
    });
    const unaffected = makeResult({
      rule_id: 'UNAFFECTED',
      technical_details: { found: 'issue on "checkout"', expected: '', evidence: [] },
    });
    const steps = [
      makeStep({ step: 'onboarding', source: 'fallback_landing' }),
      makeStep({ step: 'checkout', source: 'nav_link' }),
    ];
    const { assessable, unassessable } = partitionCoverageAffected([affected, unaffected], steps);
    expect(assessable).toEqual([unaffected]);
    expect(unassessable).toHaveLength(1);
    expect(unassessable[0].rule_id).toBe('AFFECTED');
  });

  it('checks evidence array entries as well as found text', () => {
    const result = makeResult({
      rule_id: 'EVIDENCE_ONLY',
      technical_details: { found: 'summary text with no quotes', expected: '', evidence: ['detail for "onboarding"'] },
    });
    const steps = [makeStep({ step: 'onboarding', source: 'fallback_landing' })];
    const { unassessable } = partitionCoverageAffected([result], steps);
    expect(unassessable).toHaveLength(1);
  });
});
