/**
 * Scoring Engine (Sprint 4)
 * Converts raw ValidationResult[] into 4 business scores.
 * The denominator for Conversion Signal Health is results.length,
 * so platform-filtered runs score correctly against their subset of rules.
 */
import type { AuditScores, ValidationResult } from '@/types/audit';

// Attribution rules
const ATTRIBUTION_RULES = [
  'GCLID_CAPTURED_AT_LANDING',
  'FBCLID_CAPTURED_AT_LANDING',
  'TRANSACTION_ID_PRESENT',
] as const;

// Optimization signal rules
const OPTIMIZATION_RULES = [
  'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
  'PHONE_CAPTURED_FOR_CAPI',
  'USER_ID_PRESENT',
  'ITEMS_ARRAY_POPULATED',
] as const;

// Data consistency rules
const CONSISTENCY_RULES = [
  'EVENT_ID_GENERATED',
  'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
] as const;

export function calculateScores(results: ValidationResult[]): AuditScores {
  const resultMap = new Map(results.map((r) => [r.rule_id, r]));
  const passingCount = results.filter((r) => r.status === 'pass').length;
  const totalApplicable = results.length;

  // 1. Conversion Signal Health = (passing / applicable) * 100
  //    Uses results.length as denominator so platform-filtered runs
  //    are scored against their own subset, not always /26.
  const conversionSignalHealth = totalApplicable > 0
    ? Math.round((passingCount / totalApplicable) * 100)
    : 0;

  // 2. Attribution Risk Level — only count rules that were actually run
  const attributionFailCount = ATTRIBUTION_RULES.filter(
    (id) => resultMap.has(id) && resultMap.get(id)?.status !== 'pass',
  ).length;
  const attributionApplicable = ATTRIBUTION_RULES.filter((id) => resultMap.has(id)).length;
  const attributionRiskLevel =
    attributionApplicable === 0
      ? 'Low'
      : attributionFailCount === attributionApplicable
      ? 'Critical'
      : attributionFailCount >= 2
      ? 'High'
      : attributionFailCount === 1
      ? 'Medium'
      : 'Low';

  // 3. Optimization Strength — only count rules that were actually run
  const optimizationPassCount = OPTIMIZATION_RULES.filter(
    (id) => resultMap.has(id) && resultMap.get(id)?.status === 'pass',
  ).length;
  const optimizationApplicable = OPTIMIZATION_RULES.filter((id) => resultMap.has(id)).length;
  const optimizationStrength =
    optimizationApplicable === 0
      ? 'Moderate'
      : optimizationPassCount === optimizationApplicable
      ? 'Strong'
      : optimizationPassCount >= Math.ceil(optimizationApplicable / 2)
      ? 'Moderate'
      : 'Weak';

  // 4. Data Consistency Score — only count rules that were actually run
  const consistencyPassCount = CONSISTENCY_RULES.filter(
    (id) => resultMap.has(id) && resultMap.get(id)?.status === 'pass',
  ).length;
  const consistencyApplicable = CONSISTENCY_RULES.filter((id) => resultMap.has(id)).length;
  const dataConsistencyScore =
    consistencyApplicable === 0
      ? 'High'
      : consistencyPassCount === consistencyApplicable
      ? 'High'
      : consistencyPassCount >= 1
      ? 'Medium'
      : 'Low';

  return {
    conversion_signal_health: conversionSignalHealth,
    attribution_risk_level: attributionRiskLevel,
    optimization_strength: optimizationStrength,
    data_consistency_score: dataConsistencyScore,
  };
}
