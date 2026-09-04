/**
 * Check Register v2 scoring tests.
 */
import { describe, it, expect } from 'vitest';
import { calculateV2Scores } from '../scoring';
import type { ValidationResult } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'click_id_capture',
    status: 'pass',
    severity: 'high',
    technical_details: { found: '', expected: '', evidence: [] },
    ...overrides,
  };
}

describe('calculateV2Scores', () => {
  it('returns baseline scores for an empty result set', () => {
    const scores = calculateV2Scores([]);
    expect(scores.conversion_signal_health).toBe(0);
    expect(scores.attribution_risk_level).toBe('Low');
    expect(scores.optimization_strength).toBe('Moderate');
    expect(scores.data_consistency_score).toBe('High');
  });

  it('conversion_signal_health is the pass rate over non-skipped results', () => {
    const results = [
      makeResult({ rule_id: 'A', status: 'pass' }),
      makeResult({ rule_id: 'B', status: 'pass' }),
      makeResult({ rule_id: 'C', status: 'fail' }),
      makeResult({ rule_id: 'D', status: 'skipped' }), // excluded from the denominator
    ];
    expect(calculateV2Scores(results).conversion_signal_health).toBe(67); // 2/3 rounded
  });

  it('attribution_risk_level is Critical when every L2/L3 result fails', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'fail' }),
      makeResult({ rule_id: 'B', validation_layer: 'storage_durability', status: 'fail' }),
    ];
    expect(calculateV2Scores(results).attribution_risk_level).toBe('Critical');
  });

  it('attribution_risk_level is Low when L2/L3 all pass', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'storage_durability', status: 'pass' }),
    ];
    expect(calculateV2Scores(results).attribution_risk_level).toBe('Low');
  });

  it('attribution_risk_level ignores layers other than L2/L3', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'fail' }),
    ];
    expect(calculateV2Scores(results).attribution_risk_level).toBe('Low');
  });

  it('optimization_strength is Strong when L6/L7 all pass', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'parameter_completeness', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'identity_match_quality', status: 'pass' }),
    ];
    expect(calculateV2Scores(results).optimization_strength).toBe('Strong');
  });

  it('optimization_strength is Weak when most of L6/L7 fail', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'parameter_completeness', status: 'fail' }),
      makeResult({ rule_id: 'B', validation_layer: 'parameter_completeness', status: 'fail' }),
      makeResult({ rule_id: 'C', validation_layer: 'identity_match_quality', status: 'pass' }),
    ];
    expect(calculateV2Scores(results).optimization_strength).toBe('Weak');
  });

  it('data_consistency_score is High when L12 all pass', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'hygiene_integrity', status: 'pass' })];
    expect(calculateV2Scores(results).data_consistency_score).toBe('High');
  });

  it('data_consistency_score is Low when most of L12 fails', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'hygiene_integrity', status: 'fail' }),
      makeResult({ rule_id: 'B', validation_layer: 'hygiene_integrity', status: 'fail' }),
      makeResult({ rule_id: 'C', validation_layer: 'hygiene_integrity', status: 'pass' }),
    ];
    expect(calculateV2Scores(results).data_consistency_score).toBe('Low');
  });
});

// ── Severity-weighted conversion_signal_health (PRD "Signal Health Report" Issue 7) ──

describe('calculateV2Scores — severity weighting', () => {
  // 9 critical fails + 7 passes (of assorted lower severity) — deliberately
  // shaped like the PRD's own openart.ai example: a flat pass rate reads as
  // "middling" while the real picture is "core measurement is broken."
  const mostlyPassingButCriticallyBroken = [
    ...Array.from({ length: 7 }, (_, i) => makeResult({ rule_id: `pass-${i}`, severity: 'low', status: 'pass' })),
    ...Array.from({ length: 9 }, (_, i) => makeResult({ rule_id: `crit-fail-${i}`, severity: 'critical', status: 'fail' })),
  ];

  it('a severity-weighted score drags down harder on critical failures than the flat pass rate would', () => {
    const flatPassRate = Math.round((7 / 16) * 100); // 44
    const weighted = calculateV2Scores(mostlyPassingButCriticallyBroken).conversion_signal_health;
    expect(weighted).toBeLessThan(flatPassRate);
  });

  it('setting every severity weight equal reproduces the flat pass-rate score exactly, for a mixed-severity result set', () => {
    const equalWeights = { critical: 1, high: 1, medium: 1, low: 1 };
    const flatPassRate = Math.round((7 / 16) * 100);
    expect(calculateV2Scores(mostlyPassingButCriticallyBroken, equalWeights).conversion_signal_health).toBe(flatPassRate);
  });

  it('a warning contributes zero credit toward the weighted score, same as a fail', () => {
    const results = [
      makeResult({ rule_id: 'A', severity: 'medium', status: 'pass' }),
      makeResult({ rule_id: 'B', severity: 'medium', status: 'warning' }),
    ];
    expect(calculateV2Scores(results).conversion_signal_health).toBe(50);
  });

  it('the same stored results can be re-scored against a different weight table with no crawl invoked — a historical audit can be re-weighted from audit_findings alone', () => {
    const results = mostlyPassingButCriticallyBroken;
    const gentle = calculateV2Scores(results, { critical: 2, high: 2, medium: 1, low: 1 }).conversion_signal_health;
    const harsh = calculateV2Scores(results, { critical: 10, high: 2, medium: 1, low: 1 }).conversion_signal_health;
    expect(harsh).toBeLessThan(gentle);
  });

  it('defaults to the DEFAULT_SEVERITY_WEIGHTS config when no weight table is passed', () => {
    const withDefault = calculateV2Scores(mostlyPassingButCriticallyBroken).conversion_signal_health;
    const withExplicitDefault = calculateV2Scores(mostlyPassingButCriticallyBroken, { critical: 4, high: 2, medium: 1, low: 0.5 }).conversion_signal_health;
    expect(withDefault).toBe(withExplicitDefault);
  });
});
