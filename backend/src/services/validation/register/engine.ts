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
  AuditData, ValidationRule, ValidationResult, SiteType, DeclaredPlatform, PlatformScope,
} from '@/types/audit';
import logger from '@/utils/logger';

/** The full Check Register v2 rule library. Populated as each layer (L0-L12) ships. */
export const REGISTER: ValidationRule[] = [];

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
 * Run every applicable rule in the Check Register v2 library against the
 * given AuditData. A rule that throws is caught and returned as 'warning'
 * with the error in evidence — same failure contract as the v1 engine
 * (../engine.ts's runAllRules).
 */
export function runRegister(auditData: AuditData, rules: ValidationRule[] = REGISTER): ValidationResult[] {
  const applicable = rules.filter((rule) => isRuleApplicable(rule, auditData));

  return applicable.map((rule) => {
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
