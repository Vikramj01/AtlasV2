/**
 * Unit tests for isRegressionComparable (Site Evaluation Coverage & Honesty
 * PRD §6.7/§9) — worker.ts's regression comparator uses this to decide
 * whether two scheduled-audit runs' scores are safe to compare.
 */
import { describe, it, expect } from 'vitest';
import { isRegressionComparable } from '../regressionComparability';

describe('isRegressionComparable', () => {
  it('is comparable when both runs used the same rule_set_version', () => {
    expect(isRegressionComparable('v2', 'v2')).toBe(true);
    expect(isRegressionComparable('v1-legacy', 'v1-legacy')).toBe(true);
  });

  it('is not comparable when rule_set_version differs — a v1 baseline vs. a v2 re-run', () => {
    expect(isRegressionComparable('v1-legacy', 'v2')).toBe(false);
    expect(isRegressionComparable('v2', 'v1-legacy')).toBe(false);
  });

  it('is not comparable when the previous version is missing (pre-this-field baseline)', () => {
    expect(isRegressionComparable(undefined, 'v2')).toBe(false);
    expect(isRegressionComparable(null, 'v2')).toBe(false);
  });

  it('is not comparable when the current version is missing', () => {
    expect(isRegressionComparable('v2', undefined)).toBe(false);
  });

  it('is not comparable when both are missing', () => {
    expect(isRegressionComparable(undefined, undefined)).toBe(false);
    expect(isRegressionComparable(null, null)).toBe(false);
  });
});
