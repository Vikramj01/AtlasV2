/**
 * Check Register v2 — Applicability Engine
 *
 * Runs the v2 ValidationRule library (types/audit.ts) against AuditData,
 * filtering by site_type (applies_to) and declared platforms
 * (platform_scope) BEFORE execution — the same "exclude rather than run and
 * fail" shape as the v1 engine's funnel_types/isRuleApplicableToFunnel
 * (../engine.ts), extended with a second axis for declared platforms.
 *
 * Why exclude rather than mark 'skipped': an undeclared platform's rules
 * are therefore absent from the returned results entirely — not present,
 * not failed. reporting/generator.ts's buildPlatformBreakdown() already
 * renders a platform with zero results as 'not_included' (Out of Scope),
 * so this composes with existing reporting logic with no changes needed
 * there — the exact "Meta scored as Broken when the advertiser doesn't buy
 * Meta" bug this Scan Input was built to fix.
 *
 * L0.1 ("declared platform has a tag present") is architecturally
 * different from every other platform-scoped rule: rather than "only
 * relevant if platform X is declared", it means "evaluate once per
 * declared platform". Rather than special-case fan-out here, L0.1's own
 * test() iterates auditData.declared_platforms internally and returns one
 * aggregate ValidationResult (evidence array) — the same pattern already
 * used throughout this codebase for multi-item findings (e.g.
 * CUSTOM_HTML_TAG_BYPASSES_CONSENT in tagConfiguration.ts). platform_scope:
 * 'declared' is therefore treated the same as 'any'/'n/a' here — always
 * applicable, no per-platform filtering — it's a documentation marker for
 * the technical appendix, not a different execution mode.
 */
import type {
  AuditData, ValidationRule, ValidationResult, SiteType, DeclaredPlatform, PlatformScope, RulePrecondition,
} from '@/types/audit';
import logger from '@/utils/logger';
import { L0_RULES, conversionSurfaceReached } from './L0';
import { L1_RULES } from './L1';
import { L2_RULES } from './L2';
import { L3_RULES } from './L3';
import { L4_RULES } from './L4';
import { L5_RULES } from './L5';
import { L6_RULES } from './L6';
import { L7_RULES } from './L7';
import { L8_RULES } from './L8';
import { L9_RULES } from './L9';
import { L12_RULES } from './L12';

/** The full Check Register v2 rule library. Populated as each layer (L0-L12) ships. */
export const REGISTER: ValidationRule[] = [
  ...L0_RULES, ...L1_RULES, ...L2_RULES, ...L3_RULES, ...L4_RULES, ...L5_RULES, ...L6_RULES, ...L7_RULES,
  ...L8_RULES, ...L9_RULES, ...L12_RULES,
];

export function isApplicableToSiteType(
  applies_to: SiteType[] | 'all',
  siteType: SiteType | undefined,
): boolean {
  if (applies_to === 'all') return true;
  if (!siteType) return true; // malformed/missing data — never silently hide checks
  return applies_to.includes(siteType);
}

export function isApplicableToDeclaredPlatforms(
  platform_scope: PlatformScope,
  declaredPlatforms: DeclaredPlatform[] | undefined,
): boolean {
  // 'declared' (L0.1's per-platform fan-out, handled inside its own test()),
  // 'any' (platform-agnostic infrastructure), and 'n/a' (not platform-gated)
  // are always applicable regardless of what's declared.
  if (platform_scope === 'declared' || platform_scope === 'any' || platform_scope === 'n/a') return true;
  if (!declaredPlatforms) return true; // malformed/missing data — never silently hide checks
  return platform_scope.some((p) => declaredPlatforms.includes(p));
}

export function isRuleApplicable(rule: ValidationRule, auditData: AuditData): boolean {
  return (
    isApplicableToSiteType(rule.applies_to, auditData.site_type) &&
    isApplicableToDeclaredPlatforms(rule.platform_scope, auditData.declared_platforms)
  );
}

/**
 * One evaluator per RulePrecondition value (Site Evaluation Coverage &
 * Honesty PRD §6.3) — "skip, don't fail, what could not be tested". A
 * Record (not a switch) so TypeScript enforces every RulePrecondition has
 * an evaluator here, whether or not any rule currently declares it.
 *
 * 'conversion_surface' reuses L0.3's own conversionSurfaceReached() rather
 * than reimplementing the check, so a rule gated on this can never disagree
 * with what L0.3 itself reports.
 *
 * 'distinct_product_domain' isn't tagged on any rule yet (Phase 1 only uses
 * 'conversion_surface' — see L4.ts/L5.ts/L6.ts/L7.ts), but is declared here
 * for type completeness. product_domain_reachable is only ever set
 * (non-undefined) once journeySimulator has confirmed product_domain is a
 * genuinely distinct, reachable host, so that's a correct proxy for "was
 * there a distinct product domain to test" if a future rule needs it.
 */
const PRECONDITION_CHECKS: Record<RulePrecondition, (auditData: AuditData) => boolean> = {
  conversion_surface: conversionSurfaceReached,
  distinct_product_domain: (auditData) => auditData.product_domain_reachable === true,
};

function unmetPreconditions(rule: ValidationRule, auditData: AuditData): RulePrecondition[] {
  return (rule.requires ?? []).filter((precondition) => !PRECONDITION_CHECKS[precondition](auditData));
}

function unmetPreconditionEvidence(precondition: RulePrecondition, auditData: AuditData): string {
  if (precondition === 'conversion_surface') {
    const stepCoverage = auditData.step_coverage;
    if (stepCoverage && stepCoverage.length > 0) {
      const fellBack = stepCoverage.filter(
        (s) => s.step !== 'landing' && !(s.distinct_from_landing && s.navigation_success),
      );
      return fellBack.length > 0
        ? `Steps that fell back to the landing URL: ${fellBack.map((s) => s.step).join(', ')}`
        : 'No non-landing steps were attempted';
    }
    return 'The crawl never progressed past the landing page';
  }
  return auditData.product_domain
    ? `${auditData.product_domain} was not confirmed as a distinct, reachable host`
    : 'No distinct product_domain was declared';
}

function skippedForPrecondition(
  rule: ValidationRule,
  unmet: RulePrecondition[],
  auditData: AuditData,
): ValidationResult {
  return {
    rule_id: rule.rule_id,
    validation_layer: rule.layer,
    status: 'skipped',
    severity: rule.severity,
    technical_details: {
      found: unmet.includes('conversion_surface')
        ? 'Not tested — the crawl never reached a page distinct from the landing page'
        : 'Not tested — a required precondition was not met',
      expected: rule.check,
      evidence: unmet.map((precondition) => unmetPreconditionEvidence(precondition, auditData)),
    },
  };
}

/**
 * Run every applicable rule in the Check Register v2 library against the
 * given AuditData. Applicability filtering (site_type/platform_scope) runs
 * first, exactly as before; a rule that passes that but has an unmet
 * precondition (requires) is returned as 'skipped' rather than having
 * test() run at all — scoring.ts's scored() already excludes 'skipped' from
 * every denominator, so this alone is what stops a 42-rule homepage-only
 * scan from failing checks it never had the data to answer. A rule that
 * throws is caught and returned as 'warning' with the error in evidence —
 * same failure contract as the v1 engine (../engine.ts's runAllRules).
 */
export function runRegister(auditData: AuditData, rules: ValidationRule[] = REGISTER): ValidationResult[] {
  const applicable = rules.filter((rule) => isRuleApplicable(rule, auditData));

  return applicable.map((rule) => {
    const unmet = unmetPreconditions(rule, auditData);
    if (unmet.length > 0) return skippedForPrecondition(rule, unmet, auditData);

    try {
      return rule.test(auditData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ rule_id: rule.rule_id, register_id: rule.id, err: message }, 'Check Register rule threw — returning warning');
      return {
        rule_id: rule.rule_id,
        validation_layer: rule.layer,
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
