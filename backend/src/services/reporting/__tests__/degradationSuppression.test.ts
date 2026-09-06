/**
 * Degradation suppression tests (Platform Attribution & Determinism PRD
 * Part B, B-W4) — regression coverage for the correlated failure openart.ai
 * run `5338c1dc` produced: the TikTok pixel script failed to load, so
 * TIKTOK_CONVERSION_EVENT_FIRES correctly found no event (for the wrong
 * reason) AND STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW *passed*, because
 * the never-loaded pixel never wrote its cookie to have a lifetime problem
 * with. One upstream cause (a step that never settled), two confident but
 * untrustworthy verdicts — this is the fix for both, at once.
 */
import { describe, it, expect } from 'vitest';
import { anyStepDegraded, partitionDegradedRuns } from '../degradationSuppression';
import type { StepCoverage, ValidationResult } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'event_firing',
    status: 'fail',
    severity: 'critical',
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
    degraded: false,
    ...overrides,
  };
}

describe('anyStepDegraded', () => {
  it('is false for undefined step_coverage', () => {
    expect(anyStepDegraded(undefined)).toBe(false);
  });

  it('is false when no step degraded', () => {
    expect(anyStepDegraded([makeStep({ step: 'landing' }), makeStep({ step: 'product' })])).toBe(false);
  });

  it('is true when any step degraded', () => {
    expect(anyStepDegraded([makeStep({ step: 'landing' }), makeStep({ step: 'confirmation', degraded: true })])).toBe(true);
  });
});

describe('partitionDegradedRuns', () => {
  it('passes every result through unchanged when step_coverage is undefined', () => {
    const results = [makeResult({ rule_id: 'TIKTOK_CONVERSION_EVENT_FIRES' })];
    const { assessable, unassessable } = partitionDegradedRuns(results, undefined);
    expect(assessable).toEqual(results);
    expect(unassessable).toEqual([]);
  });

  it('passes every result through unchanged when no step degraded', () => {
    const results = [makeResult({ rule_id: 'TIKTOK_CONVERSION_EVENT_FIRES', status: 'fail' })];
    const steps = [makeStep({ step: 'landing' }), makeStep({ step: 'confirmation' })];
    const { assessable, unassessable } = partitionDegradedRuns(results, steps);
    expect(assessable).toEqual(results);
    expect(unassessable).toEqual([]);
  });

  it('the OpenArt scenario: a degraded landing step moves both the false-fail and the false-pass to could_not_be_assessed', () => {
    const tiktokFail = makeResult({ rule_id: 'TIKTOK_CONVERSION_EVENT_FIRES', status: 'fail' }); // pixel never loaded — false-negative "no event"
    const storageLifetimePass = makeResult({
      rule_id: 'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW',
      validation_layer: 'storage_durability',
      status: 'pass', // no cookie was ever written to have a lifetime problem with — a false pass
    });
    const unrelated = makeResult({ rule_id: 'GTM_CONTAINER_LOADED', validation_layer: 'foundation_tags', status: 'pass' });

    const steps = [
      makeStep({ step: 'landing', degraded: true, settle_outcome: 'quiet_period_cap_reached' }),
      makeStep({ step: 'confirmation', degraded: false }),
    ];

    const { assessable, unassessable } = partitionDegradedRuns([tiktokFail, storageLifetimePass, unrelated], steps);

    expect(assessable).toEqual([unrelated]);
    expect(unassessable.map((u) => u.rule_id).sort()).toEqual(['STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW', 'TIKTOK_CONVERSION_EVENT_FIRES']);
    expect(unassessable[0].reason).toContain('landing');
  });

  it('names every degraded step in the reason text when more than one step degraded', () => {
    const result = makeResult({ rule_id: 'GA4_CONVERSION_EVENT_FIRES' });
    const steps = [
      makeStep({ step: 'landing', degraded: true }),
      makeStep({ step: 'confirmation', degraded: true }),
    ];
    const { unassessable } = partitionDegradedRuns([result], steps);
    expect(unassessable[0].step).toBe('landing, confirmation');
    expect(unassessable[0].reason).toContain('landing, confirmation');
  });

  it('does not touch a rule outside the absence-sensitive set, even on a degraded run', () => {
    const result = makeResult({ rule_id: 'GCLID_CAPTURED_AT_LANDING', status: 'fail' });
    const steps = [makeStep({ step: 'landing', degraded: true })];
    const { assessable, unassessable } = partitionDegradedRuns([result], steps);
    expect(assessable).toEqual([result]);
    expect(unassessable).toEqual([]);
  });

  it('does not double-flag an already-skipped result', () => {
    const result = makeResult({ rule_id: 'TIKTOK_CONVERSION_EVENT_FIRES', status: 'skipped' });
    const steps = [makeStep({ step: 'landing', degraded: true })];
    const { assessable, unassessable } = partitionDegradedRuns([result], steps);
    expect(assessable).toEqual([result]);
    expect(unassessable).toEqual([]);
  });

  // Report Correctness Programme PRD Part C3 — "unsettled steps are
  // all-or-nothing." Birkenstock's 15-error finding on
  // CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS (L12.8) survived the
  // old fixed ABSENCE_SENSITIVE_RULE_IDS allowlist because that rule was
  // never added to it — the exact "deciding rule-by-rule... will be wrong
  // repeatedly" failure mode the PRD calls out. This is not in the
  // allowlist, and is still caught here via the quoted step name its own
  // evidence already cites, same convention coverageSuppression.ts uses.
  it('suppresses a rule outside ABSENCE_SENSITIVE_RULE_IDS when its own evidence names a degraded step by quoted name', () => {
    const result = makeResult({
      rule_id: 'CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS',
      validation_layer: 'hygiene_integrity',
      status: 'fail',
      technical_details: {
        found: '15 JavaScript error(s) on the conversion surface ("confirmation")',
        expected: 'The confirmation state renders reliably',
        evidence: ['some ambient error'],
      },
    });
    const steps = [
      makeStep({ step: 'landing' }),
      makeStep({ step: 'confirmation', degraded: true, settle_outcome: 'quiet_period_cap_reached' }),
    ];
    const { assessable, unassessable } = partitionDegradedRuns([result], steps);
    expect(assessable).toEqual([]);
    expect(unassessable).toHaveLength(1);
    expect(unassessable[0].step).toBe('confirmation');
    expect(unassessable[0].reason).toContain('"confirmation"');
  });

  it('a rule citing a step that is NOT degraded stays assessable even when some other step degraded', () => {
    const result = makeResult({
      rule_id: 'CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS',
      technical_details: { found: 'No JavaScript errors on the conversion surface ("product")', expected: '', evidence: [] },
    });
    const steps = [
      makeStep({ step: 'landing', degraded: true }),
      makeStep({ step: 'product', degraded: false }),
    ];
    const { assessable, unassessable } = partitionDegradedRuns([result], steps);
    expect(assessable).toEqual([result]);
    expect(unassessable).toEqual([]);
  });
});
