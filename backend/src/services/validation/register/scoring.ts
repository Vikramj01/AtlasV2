/**
 * Check Register v2 scoring — produces the same AuditScores shape the v1
 * engine's scoring/engine.ts does (so the frontend needs no changes beyond
 * the nullability introduced by the Scoring & Coverage Gate PRD §9 below),
 * but computed from the register's 13 layers rather than a hardcoded list
 * of v1 rule_ids. v1's ATTRIBUTION_RULES/OPTIMIZATION_RULES/
 * CONSISTENCY_RULES allowlists don't generalize here — many v2 rule_ids
 * don't exist in that list, and the ones that coincidentally share a name
 * with a v1 rule (GCLID_CAPTURED_AT_LANDING, TRANSACTION_ID_PRESENT, ...)
 * would silently under-count everything else in the same layer.
 * Percentage-based thresholds over each score's associated layer(s)
 * generalize to any layer's rule count instead.
 *
 * Pre-Connection Scan Confidence Tiering PRD §9 — every score (the overall
 * composite and each of the three sub-scores) is now withheld (null)
 * rather than shown when the layers behind it weren't confirmed deeply
 * enough this run: each layer needs at least MIN_CONFIRMED_RATIO of its
 * applicable-this-run rules resolved to a real PASS/FAIL verdict before it
 * counts toward that score's coverage_ratio at all (layers.ts's
 * layerScoringDecisions below), and coverage_ratio itself must clear
 * COVERAGE_GATE_THRESHOLD (0.60) before the score renders as a number/
 * label instead of a Coverage Gate panel. A layer that doesn't clear its
 * own floor contributes nothing to the score it would have fed — "never
 * scored as zero and never silently averaged away" (§9.1.2).
 */
import type { AuditScores, ValidationResult, ValidationLayerV2, Severity, ScoreCoverage } from '@/types/audit';
import { DEFAULT_SEVERITY_WEIGHTS } from '@/config/scoringWeights';
import { ALL_V2_LAYERS, LAYER_WEIGHT, MIN_CONFIRMED_RATIO, COVERAGE_GATE_THRESHOLD } from './layers';

function layerResults(results: ValidationResult[], layers: ValidationLayerV2[]): ValidationResult[] {
  return results.filter((r) => layers.includes(r.validation_layer as ValidationLayerV2));
}

/**
 * Whether a result counts as real, assessable evidence for scoring
 * purposes (PRD §9.1 rule 1 — "Score is computed only over rules at
 * CONFIRMED confidence"). Operationalized via §4.3's verdict lattice
 * rather than reading observation_confidence directly: in the *non-gated*
 * direction, a PARTIAL-confidence result still resolves to a real
 * PASS/FAIL verdict (only the *gated* direction demotes PARTIAL to
 * NOT_OBSERVED), so filtering on observation_confidence === 'CONFIRMED'
 * alone would incorrectly exclude a legitimate non-gated PARTIAL pass/fail
 * too. verdict ∈ {PASS, FAIL} is exactly the set §4.3 already defines as
 * scoreable — NOT_OBSERVED/INCONCLUSIVE/CONFLICT are excluded from
 * pass/fail counts and from scoring by that same section. Falls back to
 * the pre-Sprint-2 status-based check (status !== 'skipped') for a result
 * with no verdict field at all — a v1-legacy result, or a hand-built test
 * fixture predating this field — preserving exactly the old behaviour for
 * anything that's never run through register/engine.ts's runRegister().
 */
function isScorable(r: ValidationResult): boolean {
  if (r.verdict !== undefined) return r.verdict === 'PASS' || r.verdict === 'FAIL';
  return r.status !== 'skipped';
}

function scored(results: ValidationResult[]): ValidationResult[] {
  return results.filter(isScorable);
}

export interface LayerScoringDecision {
  layer: ValidationLayerV2;
  applicable_rules: number;
  confirmed_rules: number;
  min_confirmed_rules: number;
  scored: boolean;
}

/**
 * PRD §9.1 rule 2 — per layer, how many of its applicable-this-run results
 * (every result the register produced for it — skipped/INCONCLUSIVE ones
 * included, since those represent a rule that legitimately couldn't be
 * confirmed this run, not one that never applied) reached a real PASS/FAIL
 * verdict, against the MIN_CONFIRMED_RATIO floor (layers.ts). A layer with
 * zero applicable rules this run is never `scored` — nothing to average in
 * the first place, let alone silently.
 */
export function layerScoringDecisions(
  results: ValidationResult[],
  layers: ValidationLayerV2[] = ALL_V2_LAYERS,
): LayerScoringDecision[] {
  return layers.map((layer) => {
    const inLayer = layerResults(results, [layer]);
    const confirmed = inLayer.filter(isScorable).length;
    const minRequired = Math.max(1, Math.ceil(inLayer.length * MIN_CONFIRMED_RATIO));
    return {
      layer,
      applicable_rules: inLayer.length,
      confirmed_rules: confirmed,
      min_confirmed_rules: minRequired,
      scored: inLayer.length > 0 && confirmed >= minRequired,
    };
  });
}

/** PRD §9.1 rule 3 — Σ(weight of scored layers) / Σ(weight of all layers), evaluated over whatever layer subset the caller passed to layerScoringDecisions (all 13 for the overall score, a smaller subset for each sub-score). */
export function coverageRatio(
  decisions: LayerScoringDecision[],
  weights: Record<ValidationLayerV2, number> = LAYER_WEIGHT,
): number {
  const totalWeight = decisions.reduce((sum, d) => sum + weights[d.layer], 0);
  if (totalWeight === 0) return 0;
  const scoredWeight = decisions.filter((d) => d.scored).reduce((sum, d) => sum + weights[d.layer], 0);
  return scoredWeight / totalWeight;
}

function scoredLayerSet(decisions: LayerScoringDecision[]): Set<ValidationLayerV2> {
  return new Set(decisions.filter((d) => d.scored).map((d) => d.layer));
}

/** Excludes results from a layer that didn't itself clear MIN_CONFIRMED_RATIO — the "never silently averaged away" half of §9.1 rule 2, applied even when the surrounding score's overall gate passed (e.g. 8 of 13 layers scored: the other 5 still don't get a vote). */
function inScoredLayers(results: ValidationResult[], scoredLayers: Set<ValidationLayerV2>): ValidationResult[] {
  return results.filter((r) => scoredLayers.has(r.validation_layer as ValidationLayerV2));
}

function layerCoverageFromDecisions(decisions: LayerScoringDecision[]): ScoreCoverage {
  return { layers_tested: decisions.filter((d) => d.scored).length, layers_total: decisions.length };
}

function riskLevel(failRate: number, applicableCount: number): NonNullable<AuditScores['attribution_risk_level']> {
  if (applicableCount === 0) return 'Low';
  if (failRate >= 1) return 'Critical';
  if (failRate >= 0.5) return 'High';
  if (failRate > 0) return 'Medium';
  return 'Low';
}

function strengthLevel(passRate: number, applicableCount: number): NonNullable<AuditScores['optimization_strength']> {
  if (applicableCount === 0) return 'Moderate';
  if (passRate >= 1) return 'Strong';
  if (passRate >= 0.5) return 'Moderate';
  return 'Weak';
}

function consistencyLevel(passRate: number, applicableCount: number): NonNullable<AuditScores['data_consistency_score']> {
  if (applicableCount === 0) return 'High';
  if (passRate >= 1) return 'High';
  if (passRate >= 0.5) return 'Medium';
  return 'Low';
}

// L2 (click_id_capture) + L3 (storage_durability): can the identifier be captured and survive to conversion at all.
const ATTRIBUTION_LAYERS: ValidationLayerV2[] = ['click_id_capture', 'storage_durability'];
// L6 (parameter_completeness) + L7 (identity_match_quality): does the conversion carry what a bidding/optimization model needs.
const OPTIMIZATION_LAYERS: ValidationLayerV2[] = ['parameter_completeness', 'identity_match_quality'];
// L12 (hygiene_integrity): duplicate/malformed/broken delivery — the layer most directly about data integrity.
const CONSISTENCY_LAYERS: ValidationLayerV2[] = ['hygiene_integrity'];

/**
 * Severity-weighted pass rate over scoreable results (PRD "Signal Health
 * Report" Issue 7) — each result contributes its severity's weight to the
 * denominator, and that same weight to the numerator only if it passed (a
 * 'fail' or 'warning' contributes zero credit, same treatment the old flat
 * formula gave both). Setting every weight to the same number makes this
 * identical to a flat pass-rate — a passing/applicable count ratio scaled
 * by a constant factor cancels out — which is the acceptance test proving
 * this is a strict generalisation, not a behaviour change, for anyone who
 * wants all severities weighted equally.
 */
interface WeightedSignalHealth {
  score: number;
  /** Sum of severity weights for every scoreable result that passed — stored on the audit (Report Correctness Programme PRD Part D3) so a later run's denominator/numerator can be compared against this one. */
  numerator: number;
  /** Sum of severity weights for every scoreable result in a scored layer — moves only when the set of applicable/scored rules or scored layers changes (coverage, declared platforms, register version), never when the site itself changes. */
  denominator: number;
}

function weightedSignalHealth(applicable: ValidationResult[], weights: Record<Severity, number>): WeightedSignalHealth {
  let totalWeight = 0;
  let passingWeight = 0;
  for (const r of applicable) {
    const weight = weights[r.severity];
    totalWeight += weight;
    if (r.status === 'pass') passingWeight += weight;
  }
  return {
    score: totalWeight > 0 ? Math.round((passingWeight / totalWeight) * 100) : 0,
    numerator: passingWeight,
    denominator: totalWeight,
  };
}

export function calculateV2Scores(
  results: ValidationResult[],
  severityWeights: Record<Severity, number> = DEFAULT_SEVERITY_WEIGHTS,
): AuditScores {
  // ── Overall — Conversion Signal Health, all 13 layers ────────────────────
  const overallDecisions = layerScoringDecisions(results, ALL_V2_LAYERS);
  const overallWithheld = coverageRatio(overallDecisions) < COVERAGE_GATE_THRESHOLD;
  const overallScoredLayers = scoredLayerSet(overallDecisions);
  const signalHealth = weightedSignalHealth(inScoredLayers(scored(results), overallScoredLayers), severityWeights);

  // ── Attribution Risk — L2 + L3 ────────────────────────────────────────────
  const attributionDecisions = layerScoringDecisions(results, ATTRIBUTION_LAYERS);
  const attributionWithheld = coverageRatio(attributionDecisions) < COVERAGE_GATE_THRESHOLD;
  const attribution = inScoredLayers(scored(layerResults(results, ATTRIBUTION_LAYERS)), scoredLayerSet(attributionDecisions));
  const attributionFailRate = attribution.length > 0 ? attribution.filter((r) => r.status !== 'pass').length / attribution.length : 0;
  const attributionRiskLevel = attributionWithheld ? null : riskLevel(attributionFailRate, attribution.length);

  // ── Optimization Strength — L6 + L7 ───────────────────────────────────────
  const optimizationDecisions = layerScoringDecisions(results, OPTIMIZATION_LAYERS);
  const optimizationWithheld = coverageRatio(optimizationDecisions) < COVERAGE_GATE_THRESHOLD;
  const optimization = inScoredLayers(scored(layerResults(results, OPTIMIZATION_LAYERS)), scoredLayerSet(optimizationDecisions));
  const optimizationPassRate = optimization.length > 0 ? optimization.filter((r) => r.status === 'pass').length / optimization.length : 0;
  const optimizationStrength = optimizationWithheld ? null : strengthLevel(optimizationPassRate, optimization.length);

  // ── Data Consistency — L12 ────────────────────────────────────────────────
  const consistencyDecisions = layerScoringDecisions(results, CONSISTENCY_LAYERS);
  const consistencyWithheld = coverageRatio(consistencyDecisions) < COVERAGE_GATE_THRESHOLD;
  const consistency = inScoredLayers(scored(layerResults(results, CONSISTENCY_LAYERS)), scoredLayerSet(consistencyDecisions));
  const consistencyPassRate = consistency.length > 0 ? consistency.filter((r) => r.status === 'pass').length / consistency.length : 0;
  const dataConsistencyScore = consistencyWithheld ? null : consistencyLevel(consistencyPassRate, consistency.length);

  return {
    conversion_signal_health: overallWithheld ? null : signalHealth.score,
    ...(overallWithheld ? { score_withheld_reason: 'INSUFFICIENT_LAYER_COVERAGE' as const } : {}),
    attribution_risk_level: attributionRiskLevel,
    optimization_strength: optimizationStrength,
    data_consistency_score: dataConsistencyScore,
    // Fixed denominator (Report Correctness Programme PRD Part D1) — every
    // report's header composite is "N of 13 layers scanned," 13 being the
    // ValidationLayerV2 enum's own length, never however many layers
    // happened to produce a result this run.
    conversion_signal_health_coverage: layerCoverageFromDecisions(overallDecisions),
    attribution_risk_coverage: layerCoverageFromDecisions(attributionDecisions),
    optimization_strength_coverage: layerCoverageFromDecisions(optimizationDecisions),
    data_consistency_coverage: layerCoverageFromDecisions(consistencyDecisions),
    conversion_signal_health_numerator: signalHealth.numerator,
    conversion_signal_health_denominator: signalHealth.denominator,
  };
}
