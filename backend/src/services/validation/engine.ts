/**
 * Validation Engine
 * Runs all 26 rules against AuditData and returns structured results.
 * All rules are pure functions — no side effects, no async.
 */
import type { AuditData, ValidationResult, ValidationLayer } from '@/types/audit';
import { LAYER_1_RULES } from './signalInitiation';
import { LAYER_2_RULES } from './parameterCompleteness';
import { LAYER_3_RULES } from './persistence';
import { TAG_CONFIGURATION_RULES_PHASE_A, TAG_CONFIGURATION_RULES_ALL } from './tagConfiguration';
import { IMPLEMENTATION_DRIFT_RULES } from './implementationDrift';
import logger from '@/utils/logger';

export { TAG_CONFIGURATION_RULES_PHASE_A, TAG_CONFIGURATION_RULES_ALL, IMPLEMENTATION_DRIFT_RULES };

export const ALL_RULES = [
  ...LAYER_1_RULES,
  ...LAYER_2_RULES,
  ...LAYER_3_RULES,
  ...TAG_CONFIGURATION_RULES_ALL,
  ...IMPLEMENTATION_DRIFT_RULES,
];

/**
 * Returns true if a rule applies to the given active platforms.
 * Rules with affected_platforms: ['all'] always apply.
 */
function isRuleApplicable(rule: { affected_platforms: string[] }, activePlatforms: string[]): boolean {
  return rule.affected_platforms.includes('all') ||
    rule.affected_platforms.some((p) => activePlatforms.includes(p));
}

/**
 * Run all 26 rules against the provided AuditData.
 * A rule that throws is caught and returned as 'warning' with the error in evidence.
 */
export function runAllRules(auditData: AuditData): ValidationResult[] {
  return ALL_RULES.map((rule) => {
    try {
      return rule.test(auditData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ rule_id: rule.rule_id, err: message }, 'Rule threw — returning warning');
      return {
        rule_id: rule.rule_id,
        validation_layer: rule.validation_layer,
        status: 'warning' as const,
        severity: rule.severity,
        technical_details: {
          found: 'Rule evaluation failed',
          expected: 'Rule should run without errors',
          evidence: [`Error: ${message}`],
        },
      };
    }
  });
}

/**
 * Run only the rules applicable to the given active platforms.
 * Use this in Journey mode so that deselected platforms don't
 * count against the score.
 */
export function runRulesForPlatforms(activePlatforms: string[], auditData: AuditData): ValidationResult[] {
  const applicableRules = ALL_RULES.filter((rule) => isRuleApplicable(rule, activePlatforms));

  return applicableRules.map((rule) => {
    try {
      return rule.test(auditData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ rule_id: rule.rule_id, err: message }, 'Rule threw — returning warning');
      return {
        rule_id: rule.rule_id,
        validation_layer: rule.validation_layer,
        status: 'warning' as const,
        severity: rule.severity,
        technical_details: {
          found: 'Rule evaluation failed',
          expected: 'Rule should run without errors',
          evidence: [`Error: ${message}`],
        },
      };
    }
  });
}

/**
 * Run only the rules for a specific validation layer.
 */
export function runLayer(layer: ValidationLayer, auditData: AuditData): ValidationResult[] {
  const rules = ALL_RULES.filter((r) => r.validation_layer === layer);
  return rules.map((rule) => {
    try {
      return rule.test(auditData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        rule_id: rule.rule_id,
        validation_layer: rule.validation_layer,
        status: 'warning' as const,
        severity: rule.severity,
        technical_details: {
          found: 'Rule evaluation failed',
          expected: 'Rule should run without errors',
          evidence: [`Error: ${message}`],
        },
      };
    }
  });
}

/**
 * Returns summary counts by status.
 * Skipped rules are counted separately and excluded from fail/warning totals.
 */
export function summarizeResults(results: ValidationResult[]) {
  const active = results.filter((r) => r.status !== 'skipped');
  return {
    total: active.length,
    pass: active.filter((r) => r.status === 'pass').length,
    fail: active.filter((r) => r.status === 'fail').length,
    warning: active.filter((r) => r.status === 'warning').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    by_layer: {
      signal_initiation: active.filter((r) => r.validation_layer === 'signal_initiation').length,
      parameter_completeness: active.filter((r) => r.validation_layer === 'parameter_completeness').length,
      persistence: active.filter((r) => r.validation_layer === 'persistence').length,
      tag_configuration: active.filter((r) => r.validation_layer === 'tag_configuration').length,
      implementation_drift: active.filter((r) => r.validation_layer === 'implementation_drift').length,
    },
  };
}
