/**
 * Scoring Engine (Sprint 4)
 * Converts raw ValidationResult[] into 4 business scores.
 */
import type { AuditScores, ValidationResult } from '@/types/audit';

const TOTAL_RULES = 26;

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

  // 1. Conversion Signal Health = (passing / total) * 100
  const conversionSignalHealth = Math.round((passingCount / TOTAL_RULES) * 100);

  // 2. Attribution Risk Level
  const attributionFailCount = ATTRIBUTION_RULES.filter(
    (id) => resultMap.get(id)?.status !== 'pass',
  ).length;
  const attributionRiskLevel =
    attributionFailCount === 3
      ? 'Critical'
      : attributionFailCount === 2
      ? 'High'
      : attributionFailCount === 1
      ? 'Medium'
      : 'Low';

  // 3. Optimization Strength
  const optimizationPassCount = OPTIMIZATION_RULES.filter(
    (id) => resultMap.get(id)?.status === 'pass',
  ).length;
  const optimizationStrength =
    optimizationPassCount === 4
      ? 'Strong'
      : optimizationPassCount >= 2
      ? 'Moderate'
      : 'Weak';

  // 4. Data Consistency Score
  const consistencyPassCount = CONSISTENCY_RULES.filter(
    (id) => resultMap.get(id)?.status === 'pass',
  ).length;
  const dataConsistencyScore =
    consistencyPassCount === 2 ? 'High' : consistencyPassCount === 1 ? 'Medium' : 'Low';

  return {
    conversion_signal_health: conversionSignalHealth,
    attribution_risk_level: attributionRiskLevel,
    optimization_strength: optimizationStrength,
    data_consistency_score: dataConsistencyScore,
  };
}
