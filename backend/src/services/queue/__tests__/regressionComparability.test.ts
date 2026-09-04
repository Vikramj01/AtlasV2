/**
 * Unit tests for isRegressionComparable (Site Evaluation Coverage & Honesty
 * PRD §6.7/§9) — worker.ts's regression comparator uses this to decide
 * whether two scheduled-audit runs' scores are safe to compare.
 */
import { describe, it, expect } from 'vitest';
import { isRegressionComparable } from '../regressionComparability';

const V2_FP1 = { rule_set_version: 'v2' as const, coverage_fingerprint: 'fp-1' };
const V2_FP1_AGAIN = { rule_set_version: 'v2' as const, coverage_fingerprint: 'fp-1' };
const V2_FP2 = { rule_set_version: 'v2' as const, coverage_fingerprint: 'fp-2' };
const V1_FP1 = { rule_set_version: 'v1-legacy' as const, coverage_fingerprint: 'fp-1' };

describe('isRegressionComparable', () => {
  it('is comparable when both rule_set_version and coverage_fingerprint match', () => {
    expect(isRegressionComparable(V2_FP1, V2_FP1_AGAIN)).toBe(true);
  });

  it('is not comparable when rule_set_version differs, even with the same fingerprint', () => {
    expect(isRegressionComparable(V1_FP1, V2_FP1)).toBe(false);
  });

  it('is not comparable when coverage_fingerprint differs, even with the same rule_set_version — the page-discovery case this exists for', () => {
    expect(isRegressionComparable(V2_FP1, V2_FP2)).toBe(false);
  });

  it('is not comparable when rule_set_version is missing on either run', () => {
    expect(isRegressionComparable({ coverage_fingerprint: 'fp-1' }, V2_FP1)).toBe(false);
    expect(isRegressionComparable(V2_FP1, { coverage_fingerprint: 'fp-1' })).toBe(false);
  });

  it('is not comparable when coverage_fingerprint is missing on either run', () => {
    expect(isRegressionComparable({ rule_set_version: 'v2' }, V2_FP1)).toBe(false);
    expect(isRegressionComparable(V2_FP1, { rule_set_version: 'v2' })).toBe(false);
  });

  it('is not comparable when both fields are missing on both runs', () => {
    expect(isRegressionComparable({}, {})).toBe(false);
  });

  it('treats null the same as undefined for both fields', () => {
    expect(isRegressionComparable(
      { rule_set_version: null, coverage_fingerprint: null },
      V2_FP1,
    )).toBe(false);
  });
});
