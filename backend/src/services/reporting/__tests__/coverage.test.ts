/**
 * Unit tests for buildCoverageSummary (Site Evaluation Coverage & Honesty
 * PRD §6.4) and computeCoverageFingerprint (§9).
 */
import { describe, it, expect } from 'vitest';
import { buildCoverageSummary, computeCoverageFingerprint } from '../coverage';
import type { AuditData, StepCoverage, ValidationResult } from '@/types/audit';

function makeStep(overrides: Partial<StepCoverage> = {}): StepCoverage {
  return {
    step: 'landing',
    requested_url: 'https://example.com',
    final_url: 'https://example.com',
    source: 'user_supplied',
    distinct_from_landing: false,
    navigation_success: true,
    ...overrides,
  };
}

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

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'event_firing',
    status: 'pass',
    severity: 'high',
    technical_details: { found: 'ok', expected: 'ok', evidence: [] },
    ...overrides,
  };
}

const COVERAGE_SKIPPED = (rule_id: string, layer: ValidationResult['validation_layer'] = 'event_firing'): ValidationResult =>
  makeResult({
    rule_id,
    layer,
    validation_layer: layer,
    status: 'skipped',
    technical_details: {
      found: 'Not tested — the crawl never reached a page distinct from the landing page',
      expected: 'whatever',
      evidence: ['Steps that fell back to the landing URL: product, checkout'],
    },
  });

describe('buildCoverageSummary', () => {
  it('returns undefined when step_coverage is absent — never fabricates a coverage section', () => {
    const auditData = makeAuditData({ step_coverage: undefined });
    expect(buildCoverageSummary(auditData, [])).toBeUndefined();
  });

  it('returns undefined when step_coverage is an empty array', () => {
    const auditData = makeAuditData({ step_coverage: [] });
    expect(buildCoverageSummary(auditData, [])).toBeUndefined();
  });

  it('pages_requested is the number of steps attempted', () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing' }), makeStep({ step: 'product' }), makeStep({ step: 'checkout' })],
    });
    expect(buildCoverageSummary(auditData, [])?.pages_requested).toBe(3);
  });

  it('pages_distinct counts unique successfully-navigated URLs — a homepage-only run collapses to 1', () => {
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
        makeStep({ step: 'product', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com', distinct_from_landing: false }),
        makeStep({ step: 'checkout', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com', distinct_from_landing: false }),
      ],
    });
    expect(buildCoverageSummary(auditData, [])?.pages_distinct).toBe(1);
  });

  it('pages_distinct counts each genuinely distinct page once', () => {
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
        makeStep({ step: 'product', requested_url: 'https://shop.example.com/product', final_url: 'https://shop.example.com/product', distinct_from_landing: true }),
        makeStep({ step: 'checkout', requested_url: 'https://shop.example.com/checkout', final_url: 'https://shop.example.com/checkout', distinct_from_landing: true }),
      ],
    });
    expect(buildCoverageSummary(auditData, [])?.pages_distinct).toBe(3);
  });

  it('a step that failed to navigate does not count toward pages_distinct even if its URL differs', () => {
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing' }),
        makeStep({
          step: 'confirmation',
          requested_url: 'https://shop.example.com/order-confirmed',
          final_url: undefined,
          navigation_success: false,
          error: 'net::ERR_NAME_NOT_RESOLVED',
        }),
      ],
    });
    expect(buildCoverageSummary(auditData, [])?.pages_distinct).toBe(1);
  });

  it('steps passes through the raw step_coverage array unchanged', () => {
    const steps = [makeStep({ step: 'landing' }), makeStep({ step: 'product' })];
    const auditData = makeAuditData({ step_coverage: steps });
    expect(buildCoverageSummary(auditData, [])?.steps).toBe(steps);
  });

  it('rules_not_tested counts only coverage-driven skips, not skips for other reasons', () => {
    const auditData = makeAuditData({ step_coverage: [makeStep()] });
    const results: ValidationResult[] = [
      makeResult({ rule_id: 'PASSES', status: 'pass' }),
      makeResult({ rule_id: 'FAILS', status: 'fail' }),
      makeResult({
        rule_id: 'SKIPPED_UNRELATED',
        status: 'skipped',
        technical_details: { found: 'No primary conversion declared in Scan Inputs', expected: 'x', evidence: [] },
      }),
      COVERAGE_SKIPPED('SKIPPED_FOR_COVERAGE'),
    ];
    const coverage = buildCoverageSummary(auditData, results);
    expect(coverage?.rules_not_tested).toBe(1);
    expect(coverage?.rules_tested).toBe(3); // PASSES, FAILS, SKIPPED_UNRELATED all count as "tested" in this sense
  });

  it('a layer is not_tested only when every one of its results is a coverage-driven skip', () => {
    const auditData = makeAuditData({ step_coverage: [makeStep()] });
    const results: ValidationResult[] = [
      COVERAGE_SKIPPED('L5_RULE_A', 'event_firing'),
      COVERAGE_SKIPPED('L5_RULE_B', 'event_firing'),
      COVERAGE_SKIPPED('L6_RULE_A', 'parameter_completeness'),
      makeResult({ rule_id: 'L6_RULE_B', validation_layer: 'parameter_completeness', status: 'pass' }), // one real result — layer was exercised
      makeResult({ rule_id: 'L1_RULE', validation_layer: 'foundation_tags', status: 'pass' }),
    ];
    const layersNotTested = buildCoverageSummary(auditData, results)?.layers_not_tested ?? [];
    expect(layersNotTested.map((l) => l.layer)).toEqual(['event_firing']);
    expect(layersNotTested[0].label).toBe('Event Firing');
  });

  it('returns empty layers_not_tested when nothing was skipped for coverage', () => {
    const auditData = makeAuditData({ step_coverage: [makeStep(), makeStep({ step: 'product', distinct_from_landing: true, requested_url: 'https://example.com/product', final_url: 'https://example.com/product' })] });
    const results: ValidationResult[] = [makeResult({ rule_id: 'A', status: 'pass' }), makeResult({ rule_id: 'B', status: 'fail' })];
    expect(buildCoverageSummary(auditData, results)?.layers_not_tested).toEqual([]);
  });
});

// ── computeCoverageFingerprint (§9) ─────────────────────────────────────────

describe('computeCoverageFingerprint', () => {
  it('returns undefined when step_coverage is absent', () => {
    expect(computeCoverageFingerprint(makeAuditData({ step_coverage: undefined }))).toBeUndefined();
  });

  it('returns undefined when every step failed to navigate (nothing was actually visited)', () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ navigation_success: false, final_url: undefined })],
    });
    expect(computeCoverageFingerprint(auditData)).toBeUndefined();
  });

  it('is stable across two runs that visited the same page set, regardless of step order', () => {
    const runA = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
        makeStep({ step: 'checkout', requested_url: 'https://shop.example.com/checkout', final_url: 'https://shop.example.com/checkout' }),
      ],
    });
    const runB = makeAuditData({
      step_coverage: [
        // Same two pages, reversed order and different step labels — the
        // fingerprint is a hash of the sorted URL set, not the steps array.
        makeStep({ step: 'confirmation', requested_url: 'https://shop.example.com/checkout', final_url: 'https://shop.example.com/checkout' }),
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
      ],
    });
    expect(computeCoverageFingerprint(runA)).toBe(computeCoverageFingerprint(runB));
  });

  it('differs when the set of pages visited differs — the page-discovery-improved-coverage case', () => {
    const homepageOnly = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
        makeStep({ step: 'checkout', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
      ],
    });
    const discoveredCheckout = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', requested_url: 'https://shop.example.com', final_url: 'https://shop.example.com' }),
        makeStep({ step: 'checkout', requested_url: 'https://shop.example.com/checkout', final_url: 'https://shop.example.com/checkout', source: 'sitemap', distinct_from_landing: true }),
      ],
    });
    expect(computeCoverageFingerprint(homepageOnly)).not.toBe(computeCoverageFingerprint(discoveredCheckout));
  });

  it('returns a hex string', () => {
    const auditData = makeAuditData({ step_coverage: [makeStep()] });
    const fingerprint = computeCoverageFingerprint(auditData);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });
});
