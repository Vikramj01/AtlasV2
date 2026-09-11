/**
 * Check Register v2 scoring tests, including the Scoring & Coverage Gate
 * (Pre-Connection Scan Confidence Tiering PRD §9): a layer needs at least
 * half its applicable-this-run rules confirmed (verdict PASS/FAIL) before
 * it counts toward a score's coverage_ratio at all, and a score is
 * withheld (null) when its own layers' coverage_ratio falls below 0.60.
 *
 * Many pre-existing tests below pile several results into a single
 * layer (or none) the way a minimal unit fixture naturally would — which
 * the coverage gate now correctly withholds. Where a test's own point is
 * the pass-rate/severity-weighting arithmetic rather than the gate, its
 * fixture adds `fillerResults()`: extra confirmed results in enough other
 * layers to clear the 60% floor, given `NEUTRAL_WEIGHTS` (severity 'low'
 * mapped to weight 0) so they never perturb the specific numbers under
 * test — the filler is real, scoreable evidence for coverage purposes,
 * just weighted out of the arithmetic being demonstrated.
 */
import { describe, it, expect } from 'vitest';
import { calculateV2Scores, layerScoringDecisions, coverageRatio } from '../scoring';
import { ALL_V2_LAYERS, LAYER_WEIGHT, COVERAGE_GATE_THRESHOLD } from '../layers';
import type { ValidationResult, ValidationLayerV2 } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'click_id_capture',
    status: 'pass',
    severity: 'high',
    technical_details: { found: '', expected: '', evidence: [] },
    ...overrides,
  };
}

/** critical/high/medium all weight 1 (flat), low weight 0 — pairs with fillerResults() below so filler never perturbs the arithmetic a test is actually checking. */
const NEUTRAL_WEIGHTS = { critical: 1, high: 1, medium: 1, low: 0 };

/**
 * Enough confirmed (pass), weight-neutral (severity 'low', paired with
 * NEUTRAL_WEIGHTS) results in layers other than `usedLayers` to clear the
 * overall 60% coverage floor (8 of 13 layers, equally weighted) — so a
 * test can isolate the specific arithmetic in `usedLayers` without the
 * coverage gate incidentally withholding the score it's trying to check.
 */
function fillerResults(usedLayers: ValidationLayerV2[], count = 8): ValidationResult[] {
  return ALL_V2_LAYERS.filter((l) => !usedLayers.includes(l))
    .slice(0, count)
    .map((layer, i) => makeResult({ rule_id: `filler-${i}`, validation_layer: layer, severity: 'low', status: 'pass' }));
}

describe('calculateV2Scores', () => {
  it('withholds every score for a completely empty result set (no layers scored at all)', () => {
    const scores = calculateV2Scores([]);
    expect(scores.conversion_signal_health).toBeNull();
    expect(scores.score_withheld_reason).toBe('INSUFFICIENT_LAYER_COVERAGE');
    expect(scores.attribution_risk_level).toBeNull();
    expect(scores.optimization_strength).toBeNull();
    expect(scores.data_consistency_score).toBeNull();
  });

  it('conversion_signal_health is the pass rate over scoreable results, once enough layers clear the coverage floor', () => {
    const results = [
      makeResult({ rule_id: 'A', status: 'pass' }),
      makeResult({ rule_id: 'B', status: 'pass' }),
      makeResult({ rule_id: 'C', status: 'fail' }),
      makeResult({ rule_id: 'D', status: 'skipped' }), // excluded from the denominator
      ...fillerResults(['click_id_capture']),
    ];
    expect(calculateV2Scores(results, NEUTRAL_WEIGHTS).conversion_signal_health).toBe(67); // 2/3 rounded
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

  // Scoring & Coverage Gate PRD §9.3 — the bug this sprint fixes: a
  // dimension with zero scored layers used to silently default to a
  // "safe" qualitative label ('Low' risk here) rather than disclosing
  // that nothing was actually assessed. It now withholds instead.
  it('attribution_risk_level is withheld (null), not a default-safe "Low", when L2/L3 never ran', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'fail' }),
    ];
    expect(calculateV2Scores(results).attribution_risk_level).toBeNull();
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
  // 9 critical fails + 7 passes (of assorted lower severity), spread one
  // per layer across all 13 layers (16 results ≥ 13 layers, so every
  // layer gets at least one, clearing the coverage floor with room to
  // spare) — deliberately shaped like the PRD's own openart.ai example: a
  // flat pass rate reads as "middling" while the real picture is "core
  // measurement is broken." Layer placement is arbitrary and irrelevant
  // to this group's arithmetic; only status/severity matter.
  const mostlyPassingButCriticallyBroken = [
    ...Array.from({ length: 7 }, (_, i) => makeResult({ rule_id: `pass-${i}`, validation_layer: ALL_V2_LAYERS[i % ALL_V2_LAYERS.length], severity: 'low', status: 'pass' })),
    ...Array.from({ length: 9 }, (_, i) => makeResult({ rule_id: `crit-fail-${i}`, validation_layer: ALL_V2_LAYERS[(i + 7) % ALL_V2_LAYERS.length], severity: 'critical', status: 'fail' })),
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
      ...fillerResults(['click_id_capture']),
    ];
    expect(calculateV2Scores(results, NEUTRAL_WEIGHTS).conversion_signal_health).toBe(50);
  });

  it('the same stored results can be re-scored against a different weight table with no crawl invoked — a historical audit can be re-weighted from audit_findings alone', () => {
    const results = mostlyPassingButCriticallyBroken;
    const gentle = calculateV2Scores(results, { critical: 2, high: 2, medium: 1, low: 1 }).conversion_signal_health;
    const harsh = calculateV2Scores(results, { critical: 10, high: 2, medium: 1, low: 1 }).conversion_signal_health;
    expect(harsh).toBeLessThan(gentle!);
  });

  it('defaults to the DEFAULT_SEVERITY_WEIGHTS config when no weight table is passed', () => {
    const withDefault = calculateV2Scores(mostlyPassingButCriticallyBroken).conversion_signal_health;
    const withExplicitDefault = calculateV2Scores(mostlyPassingButCriticallyBroken, { critical: 4, high: 2, medium: 1, low: 0.5 }).conversion_signal_health;
    expect(withDefault).toBe(withExplicitDefault);
  });
});

// ── Per-score layer coverage (Signal Health Report: Evidence Integrity & ──────
// Presentation PRD §3.6/W5) — each composite score reports how many of its
// constituent layers actually scored, so a consumer (the PDF/frontend)
// can withhold a confident label computed from only part of what the
// score's name claims to cover. The openart.ai reference case: L6
// (parameter_completeness) excluded entirely, L7 (identity_match_quality)
// passed everything — Optimization Strength used to score 'Strong' from
// L7 alone; the Coverage Gate (PRD §9.3) now withholds it instead.

describe('calculateV2Scores — per-score layer coverage', () => {
  it('reports full coverage for Optimization Strength when both L6 and L7 ran', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'parameter_completeness', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'identity_match_quality', status: 'pass' }),
    ];
    const coverage = calculateV2Scores(results).optimization_strength_coverage;
    expect(coverage).toEqual({ layers_tested: 2, layers_total: 2 });
  });

  it('withholds Optimization Strength (null, not a stale "Strong") when L6 never ran (the openart.ai shape)', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'identity_match_quality', status: 'pass' }),
    ];
    const scores = calculateV2Scores(results);
    expect(scores.optimization_strength).toBeNull();
    expect(scores.optimization_strength_coverage).toEqual({ layers_tested: 1, layers_total: 2 });
  });

  it('treats a layer with only skipped results the same as a layer that never ran', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'parameter_completeness', status: 'skipped' }),
      makeResult({ rule_id: 'B', validation_layer: 'identity_match_quality', status: 'pass' }),
    ];
    expect(calculateV2Scores(results).optimization_strength_coverage).toEqual({ layers_tested: 1, layers_total: 2 });
  });

  it('reports full coverage for Data Consistency (single-layer score) whenever L12 has any confirmed result', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'hygiene_integrity', status: 'pass' })];
    expect(calculateV2Scores(results).data_consistency_coverage).toEqual({ layers_tested: 1, layers_total: 1 });
  });

  // Report Correctness Programme PRD Part D1 — the header composite's
  // denominator is always the full 13-layer register (ALL_V2_LAYERS),
  // never however many distinct layers happened to appear in `results`
  // this run. Before this fix, a layer entirely excluded by applies_to/
  // platform_scope (so it contributes zero results, not even 'skipped')
  // silently shrank the denominator — the exact defect that showed "7 of
  // 11" for one audit and "7 of 12" for another of the same fixed rule set.
  it('reports the header composite denominator as the fixed 13-layer register, not however many layers appeared in results', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'click_id_capture', status: 'skipped' }),
      makeResult({ rule_id: 'C', validation_layer: 'foundation_tags', status: 'skipped' }),
      // Every other layer (cross_domain_continuity, event_firing, ...)
      // contributes ZERO results here — e.g. entirely applies_to-excluded
      // for this site_type — yet still counts toward the denominator.
    ];
    const coverage = calculateV2Scores(results).conversion_signal_health_coverage;
    // click_id_capture has 1 confirmed result (scored); foundation_tags's
    // only result is skipped (0 confirmed of 1 applicable, below its own
    // threshold — not scored); every other layer has zero results at all
    // — but the denominator is still 13.
    expect(coverage).toEqual({ layers_tested: 1, layers_total: 13 });
  });

  it('the header composite denominator is 13 even for a completely empty result set', () => {
    expect(calculateV2Scores([]).conversion_signal_health_coverage).toEqual({ layers_tested: 0, layers_total: 13 });
  });
});

// ── Numerator/denominator (Report Correctness Programme PRD Part D3) ─────────

describe('calculateV2Scores — conversion_signal_health numerator/denominator', () => {
  it('exposes the raw severity-weighted units behind the composite score', () => {
    const results = [
      makeResult({ rule_id: 'A', severity: 'medium', status: 'pass' }), // weight contributes to both
      makeResult({ rule_id: 'B', severity: 'medium', status: 'fail' }), // weight contributes to denominator only
      makeResult({ rule_id: 'C', severity: 'medium', status: 'skipped' }), // excluded entirely
      ...fillerResults(['click_id_capture']),
    ];
    const scores = calculateV2Scores(results, NEUTRAL_WEIGHTS);
    expect(scores.conversion_signal_health_denominator).toBe(2); // 2 scored (non-skipped) results, filler weighted to 0
    expect(scores.conversion_signal_health_numerator).toBe(1); // 1 of them passed
    expect(scores.conversion_signal_health).toBe(50);
  });

  it('is 0/0 for a completely empty result set', () => {
    const scores = calculateV2Scores([]);
    expect(scores.conversion_signal_health_numerator).toBe(0);
    expect(scores.conversion_signal_health_denominator).toBe(0);
  });
});

// ── Coverage gate mechanics (Pre-Connection Scan Confidence Tiering PRD §9) ───

describe('layerScoringDecisions', () => {
  it('a layer with zero applicable rules this run is never scored — "never scored as zero" starts with nothing to average', () => {
    const decisions = layerScoringDecisions([], ['click_id_capture']);
    expect(decisions).toEqual([{ layer: 'click_id_capture', applicable_rules: 0, confirmed_rules: 0, min_confirmed_rules: 1, scored: false }]);
  });

  it('a layer below its own min_confirmed_rules threshold does not score, even with some confirmed results', () => {
    // 4 applicable rules, only 1 confirmed — needs ceil(4 * 0.5) = 2.
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'foundation_tags', status: 'skipped' }),
      makeResult({ rule_id: 'C', validation_layer: 'foundation_tags', status: 'skipped' }),
      makeResult({ rule_id: 'D', validation_layer: 'foundation_tags', status: 'skipped' }),
    ];
    const [decision] = layerScoringDecisions(results, ['foundation_tags']);
    expect(decision).toEqual({ layer: 'foundation_tags', applicable_rules: 4, confirmed_rules: 1, min_confirmed_rules: 2, scored: false });
  });

  it('a layer at or above its min_confirmed_rules threshold scores', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'foundation_tags', status: 'fail' }),
      makeResult({ rule_id: 'C', validation_layer: 'foundation_tags', status: 'skipped' }),
      makeResult({ rule_id: 'D', validation_layer: 'foundation_tags', status: 'skipped' }),
    ];
    const [decision] = layerScoringDecisions(results, ['foundation_tags']);
    expect(decision.confirmed_rules).toBe(2);
    expect(decision.min_confirmed_rules).toBe(2);
    expect(decision.scored).toBe(true);
  });

  it('falls back to the pre-Sprint-2 status-based check for a result with no verdict field', () => {
    // No `verdict` set (a hand-built fixture, or a v1-legacy result) —
    // falls back to "status !== 'skipped'" exactly as before verdict existed.
    const results = [makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'fail' })];
    const [decision] = layerScoringDecisions(results, ['foundation_tags']);
    expect(decision.confirmed_rules).toBe(1);
    expect(decision.scored).toBe(true);
  });

  it('honours an explicit verdict over the raw status when present', () => {
    // NOT_OBSERVED (a gated-direction PARTIAL result) is not scoreable,
    // even though its raw status is 'fail'.
    const results = [makeResult({ rule_id: 'A', validation_layer: 'foundation_tags', status: 'fail', verdict: 'NOT_OBSERVED' })];
    const [decision] = layerScoringDecisions(results, ['foundation_tags']);
    expect(decision.confirmed_rules).toBe(0);
    expect(decision.scored).toBe(false);
  });
});

describe('coverageRatio', () => {
  it('is the weighted fraction of scored layers, using equal weights by default', () => {
    const decisions = layerScoringDecisions(
      ALL_V2_LAYERS.slice(0, 8).map((layer, i) => makeResult({ rule_id: `r${i}`, validation_layer: layer, status: 'pass' })),
    );
    expect(coverageRatio(decisions)).toBeCloseTo(8 / 13, 5);
  });

  it('is 0 when every layer weight is 0 (degenerate, never reached with the real LAYER_WEIGHT table)', () => {
    const decisions = layerScoringDecisions([], ['click_id_capture']);
    const zeroWeights: Record<ValidationLayerV2, number> = { ...LAYER_WEIGHT, click_id_capture: 0 };
    expect(coverageRatio(decisions, zeroWeights)).toBe(0);
  });
});

describe('calculateV2Scores — coverage gate withholding', () => {
  it('withholds the overall score when fewer than 60% of layers are scored', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'pass' })]; // 1 of 13
    const scores = calculateV2Scores(results);
    expect(scores.conversion_signal_health).toBeNull();
    expect(scores.score_withheld_reason).toBe('INSUFFICIENT_LAYER_COVERAGE');
  });

  it('does not withhold once at least 60% of layers (8 of 13) are scored', () => {
    const results = ALL_V2_LAYERS.slice(0, 8).map((layer, i) => makeResult({ rule_id: `r${i}`, validation_layer: layer, status: 'pass' }));
    expect(coverageRatio(layerScoringDecisions(results))).toBeGreaterThanOrEqual(COVERAGE_GATE_THRESHOLD);
    const scores = calculateV2Scores(results);
    expect(scores.conversion_signal_health).not.toBeNull();
    expect(scores.score_withheld_reason).toBeUndefined();
  });

  it('excludes an unscored layer\'s results from the overall score entirely, even once the overall gate passes — "never silently averaged away"', () => {
    // 8 clean, fully-confirmed layers clear the gate on their own; a 9th
    // layer has a single confirmed fail out of 4 applicable rules — below
    // its own threshold, so that fail must never reach the score.
    const clean = ALL_V2_LAYERS.slice(0, 8).map((layer, i) => makeResult({ rule_id: `clean${i}`, validation_layer: layer, status: 'pass' }));
    const thinLayer = ALL_V2_LAYERS[8];
    const belowThreshold = [
      makeResult({ rule_id: 'X', validation_layer: thinLayer, status: 'fail' }),
      makeResult({ rule_id: 'Y', validation_layer: thinLayer, status: 'skipped' }),
      makeResult({ rule_id: 'Z', validation_layer: thinLayer, status: 'skipped' }),
      makeResult({ rule_id: 'W', validation_layer: thinLayer, status: 'skipped' }),
    ];
    const scores = calculateV2Scores([...clean, ...belowThreshold], { critical: 1, high: 1, medium: 1, low: 1 });
    expect(scores.conversion_signal_health).toBe(100); // the unscored 9th layer's fail never counts
  });

  it('withholds a 2-layer sub-score (Attribution Risk) when only one of its two layers is scored — 1 of 2 is a 0.5 ratio, always below the 0.6 gate', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'pass' })];
    expect(calculateV2Scores(results).attribution_risk_level).toBeNull();
  });
});
