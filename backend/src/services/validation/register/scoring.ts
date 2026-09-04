/**
 * Check Register v2 scoring — produces the same AuditScores shape the v1
 * engine's scoring/engine.ts does (so the frontend needs no changes), but
 * computed from the register's 13 layers rather than a hardcoded list of
 * v1 rule_ids. v1's ATTRIBUTION_RULES/OPTIMIZATION_RULES/CONSISTENCY_RULES
 * allowlists don't generalize here — many v2 rule_ids don't exist in that
 * list, and the ones that coincidentally share a name with a v1 rule
 * (GCLID_CAPTURED_AT_LANDING, TRANSACTION_ID_PRESENT, ...) would silently
 * under-count everything else in the same layer. Percentage-based
 * thresholds over each score's associated layer(s) generalize to any
 * layer's rule count instead.
 */
import type { AuditScores, ValidationResult, ValidationLayerV2, Severity } from '@/types/audit';
import { DEFAULT_SEVERITY_WEIGHTS } from '@/config/scoringWeights';

function layerResults(results: ValidationResult[], layers: ValidationLayerV2[]): ValidationResult[] {
  return results.filter((r) => layers.includes(r.validation_layer as ValidationLayerV2));
}

/** Excludes 'skipped' — a rule with nothing to check for this audit shouldn't count against (or for) any score. */
function scored(results: ValidationResult[]): ValidationResult[] {
  return results.filter((r) => r.status !== 'skipped');
}

function riskLevel(failRate: number, applicableCount: number): AuditScores['attribution_risk_level'] {
  if (applicableCount === 0) return 'Low';
  if (failRate >= 1) return 'Critical';
  if (failRate >= 0.5) return 'High';
  if (failRate > 0) return 'Medium';
  return 'Low';
}

function strengthLevel(passRate: number, applicableCount: number): AuditScores['optimization_strength'] {
  if (applicableCount === 0) return 'Moderate';
  if (passRate >= 1) return 'Strong';
  if (passRate >= 0.5) return 'Moderate';
  return 'Weak';
}

function consistencyLevel(passRate: number, applicableCount: number): AuditScores['data_consistency_score'] {
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
 * Severity-weighted pass rate over non-skipped results (PRD "Signal
 * Health Report" Issue 7) — each result contributes its severity's weight
 * to the denominator, and that same weight to the numerator only if it
 * passed (a 'fail' or 'warning' contributes zero credit, same treatment
 * the old flat formula gave both). Setting every weight to the same
 * number makes this identical to a flat pass-rate — a passing/applicable
 * count ratio scaled by a constant factor cancels out — which is the
 * acceptance test proving this is a strict generalisation, not a
 * behaviour change, for anyone who wants all severities weighted equally.
 */
function weightedSignalHealth(applicable: ValidationResult[], weights: Record<Severity, number>): number {
  let totalWeight = 0;
  let passingWeight = 0;
  for (const r of applicable) {
    const weight = weights[r.severity];
    totalWeight += weight;
    if (r.status === 'pass') passingWeight += weight;
  }
  return totalWeight > 0 ? Math.round((passingWeight / totalWeight) * 100) : 0;
}

export function calculateV2Scores(
  results: ValidationResult[],
  severityWeights: Record<Severity, number> = DEFAULT_SEVERITY_WEIGHTS,
): AuditScores {
  const applicable = scored(results);
  const conversionSignalHealth = weightedSignalHealth(applicable, severityWeights);

  const attribution = scored(layerResults(results, ATTRIBUTION_LAYERS));
  const attributionFailRate = attribution.length > 0 ? attribution.filter((r) => r.status !== 'pass').length / attribution.length : 0;
  const attributionRiskLevel = riskLevel(attributionFailRate, attribution.length);

  const optimization = scored(layerResults(results, OPTIMIZATION_LAYERS));
  const optimizationPassRate = optimization.length > 0 ? optimization.filter((r) => r.status === 'pass').length / optimization.length : 0;
  const optimizationStrength = strengthLevel(optimizationPassRate, optimization.length);

  const consistency = scored(layerResults(results, CONSISTENCY_LAYERS));
  const consistencyPassRate = consistency.length > 0 ? consistency.filter((r) => r.status === 'pass').length / consistency.length : 0;
  const dataConsistencyScore = consistencyLevel(consistencyPassRate, consistency.length);

  return {
    conversion_signal_health: conversionSignalHealth,
    attribution_risk_level: attributionRiskLevel,
    optimization_strength: optimizationStrength,
    data_consistency_score: dataConsistencyScore,
  };
}
