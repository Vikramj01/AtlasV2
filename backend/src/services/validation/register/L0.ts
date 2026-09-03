/**
 * Layer L0 — Scope & Configuration (4 rules, all new).
 *
 * The gate everything else in the audit sits behind: are the declared
 * platforms actually present, is anything undeclared leaking data, did the
 * crawl reach a real conversion surface, and — for site types where it
 * matters — is the product domain even reachable. See platformDetection.ts
 * for the shared per-platform tag-presence check L0.1/L0.2 both use.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus } from '@/types/audit';
import { ALL_DECLARED_PLATFORMS, PLATFORM_LABELS, platformTagDetected } from './platformDetection';

// ── L0.1 — Declared platform has a tag present ───────────────────────────────
//
// platform_scope: 'declared' — evaluated once, iterating every declared
// platform internally, rather than once per platform (see engine.ts's
// docstring on why 'declared' isn't fan-out at the engine level).

export const DECLARED_PLATFORM_HAS_TAG: ValidationRule = {
  id: 'L0.1',
  rule_id: 'DECLARED_PLATFORM_HAS_TAG',
  layer: 'scope_configuration',
  check: 'Declared platform has a tag present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'declared',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const declared = auditData.declared_platforms ?? [];
    const missing = declared.filter((p) => !platformTagDetected(p, auditData));
    const status: RuleStatus = declared.length === 0 ? 'skipped' : missing.length > 0 ? 'fail' : 'pass';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found:
          declared.length === 0
            ? 'No platforms declared'
            : missing.length > 0
              ? `${missing.length} of ${declared.length} declared platform${declared.length !== 1 ? 's' : ''} missing a base tag`
              : `All ${declared.length} declared platform${declared.length !== 1 ? 's' : ''} have a base tag present`,
        expected: 'Every declared platform has its base tag/pixel firing on the site',
        evidence:
          declared.length === 0
            ? ['No platforms declared in Scan Inputs']
            : declared.map(
                (p) => `${PLATFORM_LABELS[p]}: ${platformTagDetected(p, auditData) ? 'tag present' : 'NO TAG DETECTED — zero measurement on this platform\'s spend'}`,
              ),
      },
    };
  },
};

// ── L0.2 — Undeclared platform tag detected ──────────────────────────────────
//
// platform_scope: 'any' — runs unconditionally; its entire purpose is
// scanning across every platform, not just declared ones.

export const UNDECLARED_PLATFORM_TAG_DETECTED: ValidationRule = {
  id: 'L0.2',
  rule_id: 'UNDECLARED_PLATFORM_TAG_DETECTED',
  layer: 'scope_configuration',
  check: 'Undeclared platform tag detected',
  severity: 'low',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const declared = new Set(auditData.declared_platforms ?? []);
    const undeclaredWithTag = ALL_DECLARED_PLATFORMS.filter(
      (p) => !declared.has(p) && platformTagDetected(p, auditData),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: undeclaredWithTag.length > 0 ? 'warning' : 'pass',
      severity: this.severity,
      technical_details: {
        found:
          undeclaredWithTag.length > 0
            ? `${undeclaredWithTag.length} undeclared platform tag${undeclaredWithTag.length !== 1 ? 's' : ''} detected: ${undeclaredWithTag.map((p) => PLATFORM_LABELS[p]).join(', ')}`
            : 'No tags detected for undeclared platforms',
        expected: 'Only declared platforms have tags firing on the site',
        evidence:
          undeclaredWithTag.length > 0
            ? undeclaredWithTag.map((p) => `${PLATFORM_LABELS[p]}: tag detected but not declared — legacy/rogue tag, or an undeclared channel worth asking about`)
            : ['No undeclared platform tags found'],
      },
    };
  },
};

// ── L0.3 — Conversion surface identified ─────────────────────────────────────
//
// The single highest-leverage rule in the register (Site Evaluation Coverage
// & Honesty PRD §6.2) — every downstream layer's credibility rests on this
// correctly detecting when the crawl never left the landing page.
//
// Primary path: reads journeySimulator.ts's step_coverage — a step "counts"
// only when it both resolved to a URL genuinely distinct from landing (not
// just relabelled) AND actually navigated successfully. This replaces the
// old label-based check, which tested step *names* rather than URLs: a step
// relabelled 'checkout' that silently fell back to the homepage used to
// read identically to a real checkout visit, so this rule could — and did —
// pass on a homepage-only scan.
//
// Fallback path: when step_coverage is absent (Journey-Builder mode's
// proxyAuditData, hand-built test fixtures, or an AuditData replayed from
// before this field existed), falls back to the original step-label check
// so those callers keep working exactly as before.

/**
 * The boolean this rule reduces to — factored out so engine.ts's
 * 'conversion_surface' precondition (§6.3) evaluates the *exact* same
 * condition L0.3 itself reports pass/fail on, rather than a second,
 * potentially-drifting reimplementation. A rule gated on this precondition
 * is 'skipped', never 'fail', when it comes back false — see engine.ts.
 */
export function conversionSurfaceReached(auditData: AuditData): boolean {
  const stepCoverage = auditData.step_coverage;

  if (stepCoverage && stepCoverage.length > 0) {
    return stepCoverage.some((s) => s.distinct_from_landing && s.navigation_success);
  }

  const nonLandingSteps = new Set(
    [...auditData.dataLayer.map((e) => e.step), ...auditData.networkRequests.map((r) => r.step)]
      .filter((s) => s && s !== 'landing' && s !== 'init'),
  );
  return nonLandingSteps.size > 0;
}

export const CONVERSION_SURFACE_IDENTIFIED: ValidationRule = {
  id: 'L0.3',
  rule_id: 'CONVERSION_SURFACE_IDENTIFIED',
  layer: 'scope_configuration',
  check: 'Conversion surface identified',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const stepCoverage = auditData.step_coverage;

    if (stepCoverage && stepCoverage.length > 0) {
      const qualifying = stepCoverage.filter((s) => s.distinct_from_landing && s.navigation_success);
      const found = qualifying.length > 0; // === conversionSurfaceReached(auditData) for this branch
      const nonLanding = stepCoverage.filter((s) => s.step !== 'landing');
      const fellBack = nonLanding.filter((s) => !(s.distinct_from_landing && s.navigation_success));

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: found ? 'pass' : 'fail',
        severity: this.severity,
        technical_details: {
          found: found
            ? `Reached ${qualifying.length} journey step${qualifying.length !== 1 ? 's' : ''} distinct from landing: ${qualifying.map((s) => s.step).join(', ')}`
            : 'No journey step reached a page distinct from landing',
          expected: 'At least one page or state matching the declared conversion is reachable',
          evidence: found
            ? [`Steps reached: ${qualifying.map((s) => s.step).join(', ')}`]
            : [
                'The crawl never progressed past the landing page — the rest of this audit is unanchored',
                fellBack.length > 0
                  ? `Steps that fell back to the landing URL: ${fellBack.map((s) => s.step).join(', ')}`
                  : 'No non-landing steps were attempted',
              ],
        },
      };
    }

    // Fallback — step_coverage not present on this AuditData.
    const nonLandingSteps = new Set(
      [...auditData.dataLayer.map((e) => e.step), ...auditData.networkRequests.map((r) => r.step)]
        .filter((s) => s && s !== 'landing' && s !== 'init'),
    );
    const found = nonLandingSteps.size > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: found
          ? `Reached ${nonLandingSteps.size} journey step${nonLandingSteps.size !== 1 ? 's' : ''} beyond landing: ${[...nonLandingSteps].join(', ')}`
          : 'No journey step beyond landing was reached',
        expected: 'At least one page or state matching the declared conversion is reachable',
        evidence: found
          ? [`Steps reached: ${[...nonLandingSteps].join(', ')}`]
          : ['The crawl never progressed past the landing page — the rest of this audit is unanchored'],
      },
    };
  },
};

// ── L0.4 — Product domain reachable ──────────────────────────────────────────
//
// Reads a pre-resolved boolean (product_domain_reachable) set by
// journeySimulator.ts's probeDomainReachable() before rules run — rules stay
// pure/synchronous, so the live HTTP probe happens there, not here.

export const PRODUCT_DOMAIN_REACHABLE: ValidationRule = {
  id: 'L0.4',
  rule_id: 'PRODUCT_DOMAIN_REACHABLE',
  layer: 'scope_configuration',
  check: 'Product domain reachable',
  severity: 'high',
  applies_to: ['plg_saas', 'marketplace'],
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const reachable = auditData.product_domain_reachable;
    const status: RuleStatus = reachable === undefined ? 'skipped' : reachable ? 'pass' : 'fail';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found:
          reachable === undefined
            ? 'No distinct product domain was probed'
            : reachable
              ? `${auditData.product_domain} responded`
              : `${auditData.product_domain} did not respond`,
        expected: 'The declared app/product domain responds and is crawlable to the auth wall',
        evidence:
          reachable === undefined
            ? ['product_domain was not set, or matches the marketing domain — nothing distinct to probe']
            : [`product_domain: ${auditData.product_domain}`, `Reachable: ${reachable}`],
      },
    };
  },
};

export const L0_RULES: ValidationRule[] = [
  DECLARED_PLATFORM_HAS_TAG,
  UNDECLARED_PLATFORM_TAG_DETECTED,
  CONVERSION_SURFACE_IDENTIFIED,
  PRODUCT_DOMAIN_REACHABLE,
];
