/**
 * Check Register v2 — Applicability Engine tests.
 *
 * Covers both applicability axes (site_type / declared_platforms) in
 * isolation and combined, the 'declared' platform_scope sentinel not being
 * filtered, malformed-data fail-open behaviour, and runRegister()'s
 * filter-then-execute + throw-safety contract.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isApplicableToSiteType, isApplicableToDeclaredPlatforms, isRuleApplicable, runRegister, deriveConfidence,
  REGISTER, gatedDirectionFor, deriveObservationConfidence, deriveVerdict, applySeverityCeiling,
} from '../engine';
import { calculateV2Scores } from '../scoring';
import type { AuditData, ValidationRule, DeclaredPlatform, StepCoverage } from '@/types/audit';

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  const rule_id = overrides.rule_id ?? 'TEST_RULE';
  const layer = overrides.layer ?? 'foundation_tags';
  const severity = overrides.severity ?? 'high';
  return {
    id: 'L1.1',
    rule_id,
    layer,
    check: 'Test check',
    severity,
    applies_to: 'all',
    platform_scope: 'any',
    detectable_by: 'crawl',
    owner: 'Marketing Ops',
    // Defaults to DIRECT (never gated) so existing status-based assertions
    // in this file are unaffected by the confidence-tiering verdict lattice
    // — override per-test when a case actually needs to exercise gating.
    evidence_class: 'DIRECT',
    test: () => ({
      rule_id,
      validation_layer: layer,
      status: 'pass',
      severity,
      technical_details: { found: 'ok', expected: 'ok', evidence: [] },
    }),
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── isApplicableToSiteType ──────────────────────────────────────────────────

describe('isApplicableToSiteType', () => {
  it("applies to every site type when applies_to is 'all'", () => {
    expect(isApplicableToSiteType('all', 'ecommerce')).toBe(true);
    expect(isApplicableToSiteType('all', 'marketplace')).toBe(true);
  });

  it('applies when the site type is in the list', () => {
    expect(isApplicableToSiteType(['plg_saas', 'marketplace'], 'plg_saas')).toBe(true);
  });

  it('does not apply when the site type is absent from the list', () => {
    expect(isApplicableToSiteType(['plg_saas', 'marketplace'], 'ecommerce')).toBe(false);
  });

  it('fails open (applies) when site_type is undefined — never silently hide checks on malformed data', () => {
    expect(isApplicableToSiteType(['plg_saas'], undefined)).toBe(true);
  });
});

// ── isApplicableToDeclaredPlatforms ─────────────────────────────────────────

describe('isApplicableToDeclaredPlatforms', () => {
  it("'any' always applies regardless of declared platforms", () => {
    expect(isApplicableToDeclaredPlatforms('any', [])).toBe(true);
    expect(isApplicableToDeclaredPlatforms('any', undefined)).toBe(true);
  });

  it("'n/a' always applies regardless of declared platforms", () => {
    expect(isApplicableToDeclaredPlatforms('n/a', [])).toBe(true);
  });

  it("'declared' (L0.1's per-platform fan-out sentinel) always applies — not platform-filtered", () => {
    expect(isApplicableToDeclaredPlatforms('declared', [])).toBe(true);
    expect(isApplicableToDeclaredPlatforms('declared', undefined)).toBe(true);
  });

  it('a specific platform list applies when at least one is declared', () => {
    expect(isApplicableToDeclaredPlatforms(['meta', 'tiktok'], ['google_ads', 'meta'])).toBe(true);
  });

  it('a specific platform list does not apply when none are declared (Out of Scope)', () => {
    expect(isApplicableToDeclaredPlatforms(['tiktok'], ['google_ads', 'meta'])).toBe(false);
  });

  it('fails open (applies) when declared_platforms is undefined — never silently hide checks on malformed data', () => {
    expect(isApplicableToDeclaredPlatforms(['meta'], undefined)).toBe(true);
  });

  it('a specific platform list does not apply against an empty declared_platforms array', () => {
    expect(isApplicableToDeclaredPlatforms(['meta'], [])).toBe(false);
  });
});

// ── isRuleApplicable (combined) ─────────────────────────────────────────────

describe('isRuleApplicable', () => {
  it('requires both site_type and platform_scope to pass', () => {
    const rule = makeRule({ applies_to: ['plg_saas'], platform_scope: ['meta'] });
    expect(isRuleApplicable(rule, makeAuditData({ site_type: 'plg_saas', declared_platforms: ['meta'] }))).toBe(true);
    expect(isRuleApplicable(rule, makeAuditData({ site_type: 'ecommerce', declared_platforms: ['meta'] }))).toBe(false);
    expect(isRuleApplicable(rule, makeAuditData({ site_type: 'plg_saas', declared_platforms: ['google_ads'] }))).toBe(false);
  });

  it('the exact reported bug: a Meta rule is inapplicable when Meta is not declared', () => {
    const rule = makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', applies_to: 'all', platform_scope: ['meta'] });
    const openArtLikeAudit = makeAuditData({ declared_platforms: ['google_ads'] }); // no meta declared
    expect(isRuleApplicable(rule, openArtLikeAudit)).toBe(false);
  });
});

// ── runRegister ──────────────────────────────────────────────────────────────

describe('runRegister', () => {
  it('runs only applicable rules and excludes inapplicable ones entirely', () => {
    const applicableRule = makeRule({ rule_id: 'RUNS', platform_scope: 'any' });
    const inapplicableRule = makeRule({ rule_id: 'SKIPPED_ENTIRELY', platform_scope: ['tiktok'] });

    const results = runRegister(makeAuditData({ declared_platforms: ['google_ads'] }), [applicableRule, inapplicableRule]);

    expect(results).toHaveLength(1);
    expect(results[0].rule_id).toBe('RUNS');
  });

  it('an undeclared platform produces zero results for its rules (Out of Scope, not a fail)', () => {
    const metaRule = makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', platform_scope: ['meta'] });
    const tiktokRule = makeRule({ id: 'L1.8', rule_id: 'TIKTOK_PIXEL_PRESENT', platform_scope: ['tiktok'] });

    const results = runRegister(makeAuditData({ declared_platforms: ['meta'] }), [metaRule, tiktokRule]);

    expect(results.map((r) => r.rule_id)).toEqual(['META_PIXEL_PRESENT']);
    // No TikTok result at all — never a 'fail' entry for an undeclared platform.
    expect(results.some((r) => r.rule_id === 'TIKTOK_PIXEL_PRESENT')).toBe(false);
  });

  it('catches a throwing rule and returns a warning result carrying the error', () => {
    const throwingRule = makeRule({
      rule_id: 'THROWS',
      test: () => { throw new Error('boom'); },
    });

    const results = runRegister(makeAuditData(), [throwingRule]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warning');
    expect(results[0].rule_id).toBe('THROWS');
    expect(results[0].technical_details.evidence[0]).toContain('boom');
  });

  it('defaults to the REGISTER export when no rules argument is passed', () => {
    // REGISTER now carries L0 (4), L1 (18), L2 (12), L3 (7), L4 (4), L5
    // (13), L6 (15), L7 (11), L8 (3), L9 (2), L10 (2), and L12 (4) rules —
    // 95 total (Pre-Connection Scan Confidence Tiering PRD splits added 2:
    // GOOGLE_GLOBAL_SITE_TAG_PRESENT -> GTAG_LOADER_PRESENT +
    // GOOGLE_ADS_AW_ID_PRESENT; FBP_AND_FBC_COOKIES_PRESENT ->
    // FBP_COOKIE_PRESENT + FBC_COOKIE_PRESENT). L11 is still scoped out
    // (needs platform connectors, not crawl data). Locks in that
    // runRegister() with no explicit rules argument actually reaches the
    // real library, not an empty stand-in.
    const results = runRegister(makeAuditData());
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.rule_id)).toContain('DECLARED_PLATFORM_HAS_TAG');
    expect(results.map((r) => r.rule_id)).toContain('GTM_CONTAINER_LOADED');
    expect(results.map((r) => r.rule_id)).toContain('GCLID_CAPTURED_AT_LANDING');
    expect(results.map((r) => r.rule_id)).toContain('GCL_AW_COOKIE_PRESENT');
    expect(results.map((r) => r.rule_id)).toContain('CROSS_DOMAIN_LINKER_CONFIGURED');
    expect(results.map((r) => r.rule_id)).toContain('PRIMARY_CONVERSION_EVENT_FIRES');
    expect(results.map((r) => r.rule_id)).toContain('CONVERSION_VALUE_PRESENT');
    expect(results.map((r) => r.rule_id)).toContain('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS');
    expect(results.map((r) => r.rule_id)).toContain('NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION');
  });

  it("a 'declared' scope rule always runs, independent of which platforms are declared", () => {
    const declaredScopeRule = makeRule({ id: 'L0.1', rule_id: 'DECLARED_PLATFORM_HAS_TAG', platform_scope: 'declared' });
    const results = runRegister(makeAuditData({ declared_platforms: [] as DeclaredPlatform[] }), [declaredScopeRule]);
    expect(results).toHaveLength(1);
  });
});

// ── requires (precondition gating) — Site Evaluation Coverage & Honesty PRD §6.3 ──

function makeStep(overrides: Partial<StepCoverage> = {}): StepCoverage {
  return {
    step: 'checkout',
    requested_url: 'https://example.com/checkout',
    source: 'user_supplied',
    distinct_from_landing: true,
    navigation_success: true,
    ...overrides,
  };
}

describe('runRegister — requires (precondition gating)', () => {
  it("a rule requiring 'conversion_surface' is skipped — not run, not failed — when the crawl never left landing", () => {
    let testWasCalled = false;
    const gatedRule = makeRule({
      id: 'L6.99',
      rule_id: 'REQUIRES_CONVERSION_SURFACE',
      layer: 'parameter_completeness',
      requires: ['conversion_surface'],
      test: () => { testWasCalled = true; return { rule_id: 'REQUIRES_CONVERSION_SURFACE', validation_layer: 'parameter_completeness', status: 'pass', severity: 'high', technical_details: { found: '', expected: '', evidence: [] } }; },
    });

    const results = runRegister(
      makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })] }),
      [gatedRule],
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].technical_details.found).toContain('the crawl never reached a page distinct from the landing page');
    expect(testWasCalled).toBe(false); // test() never even runs — precondition gate is checked first
  });

  it("a rule requiring 'conversion_surface' runs normally once a distinct, successfully-navigated step exists", () => {
    const gatedRule = makeRule({ id: 'L6.99', rule_id: 'REQUIRES_CONVERSION_SURFACE', requires: ['conversion_surface'] });

    const results = runRegister(
      makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep()] }),
      [gatedRule],
    );

    expect(results[0].status).toBe('pass'); // makeRule's default test() always returns 'pass'
  });

  it('a rule with no requires is unaffected by step_coverage', () => {
    const ungatedRule = makeRule({ rule_id: 'UNGATED' });
    const results = runRegister(
      makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })] }),
      [ungatedRule],
    );
    expect(results[0].status).toBe('pass');
  });

  it('demonstrates the scoring consequence: a skipped-for-precondition rule drops out of the conversion_signal_health denominator, a genuinely-failing one does not', () => {
    // GATED would fail if it ever ran — models an L6 rule whose data (e.g.
    // transaction_id) genuinely never showed up because the crawl never
    // reached the page that would carry it.
    const gatedRule = makeRule({
      rule_id: 'GATED',
      requires: ['conversion_surface'],
      test: () => ({ rule_id: 'GATED', validation_layer: 'parameter_completeness', status: 'fail', severity: 'high', technical_details: { found: '', expected: '', evidence: [] } }),
    });
    const passingRule = makeRule({ rule_id: 'PASSES' });

    const homepageOnly = makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })] });
    const results = runRegister(homepageOnly, [gatedRule, passingRule]);

    expect(results.map((r) => r.status)).toEqual(['skipped', 'pass']);
    // Denominator is 1 (PASSES only) — GATED is excluded entirely, never
    // counted as a failure just because the crawl couldn't reach it.
    expect(calculateV2Scores(results).conversion_signal_health).toBe(100);

    // Same two rules, but the crawl DID reach a real conversion surface —
    // GATED's test() now actually runs, and its genuine 'fail' correctly
    // drags the score down. Precondition gating only ever removes rules
    // from the denominator; it never protects a real failure from scoring.
    const reachedConversionSurface = makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep()] });
    const resultsReached = runRegister(reachedConversionSurface, [gatedRule, passingRule]);
    expect(resultsReached.map((r) => r.status)).toEqual(['fail', 'pass']);
    expect(calculateV2Scores(resultsReached).conversion_signal_health).toBe(50);
  });
});

// ── confidence (Report Honesty PRD Part A) ──────────────────────────────────

describe('deriveConfidence', () => {
  const gatedRule = makeRule({ rule_id: 'GATED', requires: ['conversion_surface'] });
  const ungatedRule = makeRule({ rule_id: 'UNGATED' });

  it("defaults to 'high' for a rule with no step-level requires, regardless of step_coverage", () => {
    const auditData = makeAuditData({ step_coverage: [makeStep({ source: 'heuristic' })] });
    expect(deriveConfidence(ungatedRule, auditData)).toBe('high');
  });

  it("defaults to 'high' when step_coverage is absent — nothing to distrust", () => {
    expect(deriveConfidence(gatedRule, makeAuditData({ step_coverage: undefined }))).toBe('high');
  });

  it("is 'high' when the qualifying step has verified provenance and didn't degrade", () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'user_supplied' })],
    });
    expect(deriveConfidence(gatedRule, auditData)).toBe('high');
  });

  it("is 'confirm' when the qualifying step was only found via a path guess ('heuristic')", () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic' })],
    });
    expect(deriveConfidence(gatedRule, auditData)).toBe('confirm');
  });

  it("is 'confirm' when the qualifying step degraded, even with verified provenance", () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'user_supplied', degraded: true })],
    });
    expect(deriveConfidence(gatedRule, auditData)).toBe('confirm');
  });

  it('runRegister attaches confidence to a real (non-skipped) result but never to a skipped one', () => {
    // A *verified* heuristic step (Report Correctness Programme PRD Part
    // C2 — http_status 2xx, no declared confirmation signal to fail) does
    // qualify as the conversion surface, so the gated rule runs — just
    // with 'confirm' confidence, since a path guess is still less certain
    // than a user-supplied URL even once verified.
    const auditData = makeAuditData({
      step_coverage: [
        makeStep({ step: 'landing', distinct_from_landing: false }),
        makeStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'not_declared' }),
      ],
    });
    const [gatedResult, ungatedResult] = runRegister(auditData, [gatedRule, ungatedRule]);
    expect(gatedResult.confidence).toBe('confirm');
    expect(ungatedResult.confidence).toBe('high');

    const skippedResult = runRegister(makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })] }), [gatedRule])[0];
    expect(skippedResult.status).toBe('skipped');
    expect(skippedResult.confidence).toBeUndefined();
  });

  // Report Correctness Programme PRD Part C2 — "verify guessed steps": an
  // *unverified* heuristic step (no http_status captured) no longer
  // qualifies as the conversion surface at all, so the gated rule is
  // skipped rather than run with a mere 'confirm' disclosure — the
  // Birkenstock-shape defect this closes is a rule running (and reporting
  // pass/fail) against a guessed page nothing confirmed was the right one.
  it('an unverified heuristic step no longer satisfies the conversion_surface precondition — the gated rule is skipped, not run with confirm confidence', () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic' })],
    });
    const [gatedResult] = runRegister(auditData, [gatedRule]);
    expect(gatedResult.status).toBe('skipped');
    expect(gatedResult.confidence).toBeUndefined();
  });

  it('confidence never changes scoring — byte-identical scores with and without it populated', () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic' })],
    });
    const failingGatedRule = makeRule({
      rule_id: 'GATED_FAIL',
      requires: ['conversion_surface'],
      test: () => ({ rule_id: 'GATED_FAIL', validation_layer: 'foundation_tags', status: 'fail', severity: 'high', technical_details: { found: '', expected: '', evidence: [] } }),
    });
    const results = runRegister(auditData, [failingGatedRule, ungatedRule]);
    const withoutConfidence = results.map(({ confidence: _confidence, ...rest }) => rest);
    expect(calculateV2Scores(results)).toEqual(calculateV2Scores(withoutConfidence));
  });
});

// ── Confidence tiering (Pre-Connection Scan Confidence Tiering PRD §4) ──────

describe('registry classification coverage', () => {
  it('every rule in REGISTER declares an evidence_class', () => {
    const unclassified = REGISTER.filter((r) => !r.evidence_class).map((r) => r.rule_id);
    expect(unclassified).toEqual([]);
  });

  it('every DERIVED rule declares a gated_direction, and no other class does', () => {
    const derivedMissingGate = REGISTER.filter((r) => r.evidence_class === 'DERIVED' && !r.gated_direction).map((r) => r.rule_id);
    expect(derivedMissingGate).toEqual([]);

    const nonDerivedWithGate = REGISTER.filter((r) => r.evidence_class !== 'DERIVED' && r.gated_direction).map((r) => r.rule_id);
    expect(nonDerivedWithGate).toEqual([]);
  });
});

describe('gatedDirectionFor', () => {
  it('returns the fixed direction for DIRECT/PRESENCE/PRESENCE_INVERSE/INFERRED', () => {
    expect(gatedDirectionFor({ evidence_class: 'DIRECT' })).toBe('none');
    expect(gatedDirectionFor({ evidence_class: 'PRESENCE' })).toBe('fail');
    expect(gatedDirectionFor({ evidence_class: 'PRESENCE_INVERSE' })).toBe('pass');
    expect(gatedDirectionFor({ evidence_class: 'INFERRED' })).toBe('both');
  });

  it('returns the declared gated_direction for DERIVED', () => {
    expect(gatedDirectionFor({ evidence_class: 'DERIVED', gated_direction: 'pass' })).toBe('pass');
  });

  it('throws for a DERIVED rule missing gated_direction', () => {
    expect(() => gatedDirectionFor({ evidence_class: 'DERIVED' })).toThrow();
  });
});

describe('deriveObservationConfidence', () => {
  const ungatedRule = makeRule({ rule_id: 'UNGATED' });
  const gatedRule = makeRule({ rule_id: 'GATED', requires: ['conversion_surface'] });

  it("maps deriveConfidence 'high' to CONFIRMED", () => {
    expect(deriveObservationConfidence(ungatedRule, makeAuditData())).toBe('CONFIRMED');
  });

  it("maps deriveConfidence 'confirm' to PARTIAL", () => {
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'not_declared' })],
    });
    expect(deriveObservationConfidence(gatedRule, auditData)).toBe('PARTIAL');
  });
});

describe('deriveVerdict', () => {
  it('DIRECT never gates — PASS/FAIL as raw regardless of confidence', () => {
    expect(deriveVerdict({ evidence_class: 'DIRECT' }, 'pass', 'CONFIRMED')).toBe('PASS');
    expect(deriveVerdict({ evidence_class: 'DIRECT' }, 'fail', 'PARTIAL')).toBe('FAIL');
  });

  it('PRESENCE gates fail: PARTIAL fail becomes NOT_OBSERVED, PARTIAL pass stays PASS', () => {
    expect(deriveVerdict({ evidence_class: 'PRESENCE' }, 'fail', 'CONFIRMED')).toBe('FAIL');
    expect(deriveVerdict({ evidence_class: 'PRESENCE' }, 'fail', 'PARTIAL')).toBe('NOT_OBSERVED');
    expect(deriveVerdict({ evidence_class: 'PRESENCE' }, 'pass', 'PARTIAL')).toBe('PASS');
  });

  it('PRESENCE_INVERSE gates pass: PARTIAL pass becomes NOT_OBSERVED, PARTIAL fail stays FAIL', () => {
    expect(deriveVerdict({ evidence_class: 'PRESENCE_INVERSE' }, 'pass', 'CONFIRMED')).toBe('PASS');
    expect(deriveVerdict({ evidence_class: 'PRESENCE_INVERSE' }, 'pass', 'PARTIAL')).toBe('NOT_OBSERVED');
    expect(deriveVerdict({ evidence_class: 'PRESENCE_INVERSE' }, 'fail', 'PARTIAL')).toBe('FAIL');
  });

  it('DERIVED reads gated_direction — gates fail here', () => {
    expect(deriveVerdict({ evidence_class: 'DERIVED', gated_direction: 'fail' }, 'fail', 'PARTIAL')).toBe('NOT_OBSERVED');
    expect(deriveVerdict({ evidence_class: 'DERIVED', gated_direction: 'fail' }, 'pass', 'PARTIAL')).toBe('PASS');
  });

  it('INFERRED: FAIL is unreachable at any confidence; PASS still needs CONFIRMED', () => {
    expect(deriveVerdict({ evidence_class: 'INFERRED' }, 'fail', 'CONFIRMED')).toBe('NOT_OBSERVED');
    expect(deriveVerdict({ evidence_class: 'INFERRED' }, 'fail', 'PARTIAL')).toBe('NOT_OBSERVED');
    expect(deriveVerdict({ evidence_class: 'INFERRED' }, 'pass', 'CONFIRMED')).toBe('PASS');
    expect(deriveVerdict({ evidence_class: 'INFERRED' }, 'pass', 'PARTIAL')).toBe('NOT_OBSERVED');
  });

  it('UNSUPPORTED confidence always renders INCONCLUSIVE, regardless of evidence_class', () => {
    expect(deriveVerdict({ evidence_class: 'PRESENCE' }, 'fail', 'UNSUPPORTED')).toBe('INCONCLUSIVE');
  });

  it('CONFLICTED confidence always renders CONFLICT', () => {
    expect(deriveVerdict({ evidence_class: 'DIRECT' }, 'pass', 'CONFLICTED')).toBe('CONFLICT');
  });

  it("treats a 'warning' status as the fail direction for gating", () => {
    expect(deriveVerdict({ evidence_class: 'PRESENCE' }, 'warning', 'PARTIAL')).toBe('NOT_OBSERVED');
  });
});

describe('applySeverityCeiling', () => {
  it('CONFIRMED never caps', () => {
    expect(applySeverityCeiling('critical', 'CONFIRMED')).toEqual({ severity: 'critical' });
  });

  it('PARTIAL caps critical/high-above down to high, recording severity_capped_from', () => {
    expect(applySeverityCeiling('critical', 'PARTIAL')).toEqual({ severity: 'high', severity_capped_from: 'critical' });
  });

  it('PARTIAL does not touch a severity already at or below high', () => {
    expect(applySeverityCeiling('high', 'PARTIAL')).toEqual({ severity: 'high' });
    expect(applySeverityCeiling('low', 'PARTIAL')).toEqual({ severity: 'low' });
  });
});

describe('runRegister — verdict/observation_confidence wiring', () => {
  it('a precondition-skip result gets UNSUPPORTED/INCONCLUSIVE', () => {
    const gatedRule = makeRule({ rule_id: 'GATED', requires: ['conversion_surface'] });
    const [result] = runRegister(makeAuditData({ step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false })] }), [gatedRule]);
    expect(result.status).toBe('skipped');
    expect(result.observation_confidence).toBe('UNSUPPORTED');
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it("a rule whose own test() returns 'skipped' also gets UNSUPPORTED/INCONCLUSIVE", () => {
    const selfSkippingRule = makeRule({
      rule_id: 'SELF_SKIPS',
      test: () => ({ rule_id: 'SELF_SKIPS', validation_layer: 'foundation_tags', status: 'skipped', severity: 'high', technical_details: { found: '', expected: '', evidence: [] } }),
    });
    const [result] = runRegister(makeAuditData(), [selfSkippingRule]);
    expect(result.observation_confidence).toBe('UNSUPPORTED');
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('a thrown rule gets UNSUPPORTED/INCONCLUSIVE alongside its warning status', () => {
    const throwingRule = makeRule({ rule_id: 'THROWS', test: () => { throw new Error('boom'); } });
    const [result] = runRegister(makeAuditData(), [throwingRule]);
    expect(result.status).toBe('warning');
    expect(result.observation_confidence).toBe('UNSUPPORTED');
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('a gated PRESENCE rule at PARTIAL confidence renders NOT_OBSERVED and caps severity, without changing status', () => {
    const gatedRule = makeRule({
      rule_id: 'GATED_FAIL',
      requires: ['conversion_surface'],
      severity: 'critical',
      evidence_class: 'PRESENCE',
      test: () => ({ rule_id: 'GATED_FAIL', validation_layer: 'foundation_tags', status: 'fail', severity: 'critical', technical_details: { found: '', expected: '', evidence: [] } }),
    });
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep({ source: 'heuristic', http_status: 200, wait_for_outcome: 'not_declared' })],
    });
    const [result] = runRegister(auditData, [gatedRule]);
    expect(result.status).toBe('fail'); // unchanged — existing consumers still see the raw status
    expect(result.observation_confidence).toBe('PARTIAL');
    expect(result.verdict).toBe('NOT_OBSERVED');
    expect(result.severity).toBe('high');
    expect(result.severity_capped_from).toBe('critical');
  });

  it('a CONFIRMED gated PRESENCE fail renders FAIL with no severity cap', () => {
    const gatedRule = makeRule({
      rule_id: 'GATED_FAIL',
      requires: ['conversion_surface'],
      severity: 'critical',
      evidence_class: 'PRESENCE',
      test: () => ({ rule_id: 'GATED_FAIL', validation_layer: 'foundation_tags', status: 'fail', severity: 'critical', technical_details: { found: '', expected: '', evidence: [] } }),
    });
    const auditData = makeAuditData({
      step_coverage: [makeStep({ step: 'landing', distinct_from_landing: false }), makeStep()],
    });
    const [result] = runRegister(auditData, [gatedRule]);
    expect(result.verdict).toBe('FAIL');
    expect(result.severity).toBe('critical');
    expect(result.severity_capped_from).toBeUndefined();
  });
});
