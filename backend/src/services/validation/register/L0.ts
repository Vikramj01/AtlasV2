/**
 * Layer L0 — Scope & Configuration (4 rules, all new).
 *
 * The gate everything else in the audit sits behind: are the declared
 * platforms actually present, is anything undeclared leaking data, did the
 * crawl reach a real conversion surface, and — for site types where it
 * matters — is the product domain even reachable. See platformDetection.ts
 * for the shared per-platform tag-presence check L0.1/L0.2 both use.
 */
import type { AuditData, ValidationRule, ValidationResult, RuleStatus, DeclaredPlatform, DeclarationSource, Severity } from '@/types/audit';
import { ALL_DECLARED_PLATFORMS, PLATFORM_LABELS, platformTagDetected } from './platformDetection';

/**
 * Pre-Connection Scan Confidence Tiering PRD §8 — severity ceiling for
 * DECLARED_PLATFORM_HAS_TAG (L0.1) by declaration_source. A local rank map
 * rather than importing engine.ts's (private, and would create a circular
 * import — engine.ts already imports L0.ts) — 4 entries, not worth sharing
 * across that boundary.
 */
const LOCAL_SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const DECLARATION_SEVERITY_CEILING: Record<DeclarationSource, Severity | undefined> = {
  CLIENT_CONFIRMED: undefined,
  OPERATOR_ASSUMED: 'medium',
  INFERRED_FROM_SITE: 'low',
};

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
  // PRD §10.1 exact — DERIVED (rests on a client declaration, capped by
  // declaration_source), gated on Fail (missing a tag is the absence claim).
  evidence_class: 'DERIVED',
  gated_direction: 'fail',
  remediation: (result) => {
    const missing = result.technical_details.evidence
      .filter((e) => e.includes('no tag observed'))
      .map((e) => e.split(':')[0]);
    if (missing.length === 0) return "Install the base tag/pixel for every declared platform — verify with each platform's own tag helper (GTM Preview, Meta Pixel Helper, etc.) that it fires on page load.";
    return `Install the base tag/pixel for ${missing.join(', ')} — verify with GTM Preview mode or the platform's own pixel-helper extension that it actually fires on page load, not just that a container is present.`;
  },
  // Pre-Connection Scan Confidence Tiering PRD §8 — "a capped finding
  // renders as an open question rather than a defect": only when
  // declaration_source capped this result's severity (i.e. the platform's
  // presence wasn't CLIENT_CONFIRMED) — a client-confirmed declaration
  // that's genuinely missing its tag is a real defect, not a question
  // about whether the platform belongs in scope at all. Returns '' to opt
  // out, which collectClientQuestions' `!!q` filter already drops.
  client_question: (result) => {
    if (!result.severity_capped_from) return '';
    const missing = result.technical_details.evidence
      .filter((e) => e.includes('no tag observed'))
      .map((e) => e.split(':')[0]);
    const names = missing.length > 0 ? missing.join(', ') : 'a declared platform';
    return `We didn't find a base tag for ${names}, and this declaration wasn't confirmed by you directly. Is ${missing.length > 1 ? 'this genuinely part of' : 'it genuinely part of'} your paid media mix, or should it come out of Scan Inputs?`;
  },

  test(auditData: AuditData): ValidationResult {
    const declared = auditData.declared_platforms ?? [];
    const missing = declared.filter((p) => !platformTagDetected(p, auditData));
    const status: RuleStatus = declared.length === 0 ? 'skipped' : missing.length > 0 ? 'fail' : 'pass';

    // Per-platform disaggregation (Platform Attribution & Determinism PRD
    // Part A) — this rule's own evidence already computes pass/fail per
    // platform internally; platform_outcomes emits that as data too, so
    // buildV2PlatformBreakdown() can credit Google Ads and TikTok for
    // passing even when the same rule's overall status is 'fail' because
    // Meta is missing its tag.
    const platform_outcomes: Partial<Record<DeclaredPlatform, RuleStatus>> = {};
    for (const p of declared) {
      platform_outcomes[p] = platformTagDetected(p, auditData) ? 'pass' : 'fail';
    }

    // Severity ceiling by declaration_source (PRD §8) — a CRITICAL for a
    // platform the operator merely assumed was in scope (not confirmed by
    // the client) rests on a declaration that may simply be wrong. Defaults
    // to OPERATOR_ASSUMED, the pre-connection default, when unset. Only ever
    // applies to a genuine fail — a pass has no defect for a ceiling to cap.
    const declarationSource: DeclarationSource = auditData.declaration_source ?? 'OPERATOR_ASSUMED';
    const ceiling = DECLARATION_SEVERITY_CEILING[declarationSource];
    const capped = status === 'fail' && ceiling !== undefined && LOCAL_SEVERITY_RANK[this.severity] > LOCAL_SEVERITY_RANK[ceiling];
    const effectiveSeverity = capped ? ceiling! : this.severity;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: effectiveSeverity,
      ...(capped ? { severity_capped_from: this.severity } : {}),
      technical_details: {
        found:
          declared.length === 0
            ? 'No platforms declared'
            : missing.length > 0
              ? `${missing.length} of ${declared.length} declared platform${declared.length !== 1 ? 's' : ''} with no base tag observed`
              : `All ${declared.length} declared platform${declared.length !== 1 ? 's' : ''} have a base tag present`,
        expected: 'Every declared platform has its base tag/pixel firing on the site',
        evidence:
          declared.length === 0
            ? ['No platforms declared in Scan Inputs']
            : declared.map(
                (p) => `${PLATFORM_LABELS[p]}: ${platformTagDetected(p, auditData) ? 'tag present' : 'no tag observed — spend on this platform is unmeasured'}`,
              ),
      },
      ...(declared.length > 0 ? { platform_outcomes } : {}),
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
  // PRD §10.1 exact — "Positive observation · strongest rule in the set."
  evidence_class: 'DIRECT',
  remediation: (result) => {
    const names = result.technical_details.evidence
      .filter((e) => e.includes('tag detected but not declared'))
      .map((e) => e.split(':')[0]);
    if (names.length === 0) return 'Confirm this rogue/legacy tag is intentional, or remove it if not.';
    return `Confirm whether ${names.join(', ')} should be a declared, actively-managed channel. If not, remove the tag — a rogue pixel still sends the site's traffic data to that platform. If so, add it to Scan Inputs' declared platforms so future audits check it properly.`;
  },
  client_question: (result) => {
    const names = result.technical_details.evidence
      .filter((e) => e.includes('tag detected but not declared'))
      .map((e) => e.split(':')[0]);
    const namesText = names.length > 0 ? names.join(', ') : 'An undeclared platform tag';
    return `${namesText} is firing but wasn't declared for this audit. Is this a channel we weren't told about, or a legacy tag that should be removed?`;
  },

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
 * Whether a step is trustworthy enough to count toward the conversion
 * surface (Report Correctness Programme PRD Part C2 — "verify guessed
 * steps"). Every step whose URL came from somewhere other than a guess
 * (user_supplied, sitemap, nav_link, fallback_landing) is trusted as-is —
 * only 'heuristic' (stepUrlResolver.ts's path-guess strategy) needs
 * verifying before it can become the conversion surface, because a guessed
 * path can 200 on a page that isn't actually the checkout/thank-you/signup
 * step it was guessed to be. Verification requires the response to have
 * been a real page (HTTP 2xx — http_status may be absent for a StepCoverage
 * captured before this field existed, which fails open toward *not*
 * verified, per "an unverified guess does not become the conversion
 * surface"), plus — where the step declared a `waitFor` confirmation
 * selector — that it actually matched (wait_for_outcome === 'matched');
 * a step with no declared waitFor has nothing further to confirm.
 */
export function isVerifiedStep(step: { source: string; http_status?: number; wait_for_outcome?: string }): boolean {
  if (step.source !== 'heuristic') return true;
  const httpOk = step.http_status !== undefined && step.http_status >= 200 && step.http_status < 300;
  const confirmationOk = step.wait_for_outcome === undefined
    || step.wait_for_outcome === 'not_declared'
    || step.wait_for_outcome === 'matched';
  return httpOk && confirmationOk;
}

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
    return stepCoverage.some((s) => s.distinct_from_landing && s.navigation_success && isVerifiedStep(s));
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
  // PRD §10.1 exact.
  evidence_class: 'DIRECT',
  remediation: 'Supply a direct URL for the conversion step in Scan Inputs\' url_map (the real checkout/thank-you/signup page — not the homepage), or fix the site\'s own navigation so that page is actually reachable by clicking through from landing. Every rule below this one depends on a real conversion surface being reached, so this is worth fixing before trusting anything else in this report.',
  client_question: 'We could not confirm your conversion page (checkout/thank-you/signup), so every check that depends on it is inconclusive. Can you supply its URL, or a test route we can use?',

  test(auditData: AuditData): ValidationResult {
    const stepCoverage = auditData.step_coverage;

    if (stepCoverage && stepCoverage.length > 0) {
      const qualifying = stepCoverage.filter((s) => s.distinct_from_landing && s.navigation_success && isVerifiedStep(s));
      const found = qualifying.length > 0; // === conversionSurfaceReached(auditData) for this branch
      const nonLanding = stepCoverage.filter((s) => s.step !== 'landing');
      const fellBack = nonLanding.filter((s) => !(s.distinct_from_landing && s.navigation_success));
      // Reached a distinct page, but as an unverified guess (Report
      // Correctness Programme PRD Part C2) — named separately from
      // fellBack so the evidence doesn't conflate "never left landing"
      // with "reached somewhere, but we can't confirm it's the right page".
      const unverifiedGuesses = nonLanding.filter(
        (s) => s.distinct_from_landing && s.navigation_success && !isVerifiedStep(s),
      );

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
                ...(unverifiedGuesses.length > 0
                  ? [`Steps reached only via an unverified guess: ${unverifiedGuesses.map((s) => s.step).join(', ')} — a path guess needs a 2xx response (and its declared confirmation signal, if any) before it counts`]
                  : []),
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
  // Not classified by the PRD — "unreachable" is an absence claim (no valid
  // response observed from a single live HTTP probe with its own timeout),
  // gated per the PRD's core principle (§3) rather than treated as DIRECT.
  evidence_class: 'PRESENCE',
  remediation: (result) => {
    const domainLine = result.technical_details.evidence.find((e) => e.startsWith('product_domain:'));
    const domain = domainLine ? domainLine.replace('product_domain: ', '') : 'the declared product domain';
    return `Verify ${domain} is publicly reachable — not behind a VPN, staging password, or auth wall the crawler can't get past — and that DNS/SSL resolve correctly. If it's intentionally gated, remove it from product_domain in Scan Inputs so this rule is skipped rather than failed.`;
  },

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
