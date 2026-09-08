/**
 * Check Register v2 reporting tests (layer breakdown + platform breakdown).
 */
import { describe, it, expect } from 'vitest';
import { buildV2LayerStages, buildV2PlatformBreakdown } from '../reporting';
import type { ValidationResult, ValidationRule, DeclaredPlatform } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'foundation_tags',
    status: 'pass',
    severity: 'high',
    technical_details: { found: 'found text', expected: 'expected text', evidence: [] },
    ...overrides,
  };
}

function makeRule(overrides: Partial<ValidationRule> & { rule_id: string; id: string }): ValidationRule {
  return {
    layer: 'foundation_tags',
    check: 'Test check',
    severity: 'high',
    applies_to: 'all',
    platform_scope: 'any',
    detectable_by: 'crawl',
    owner: 'Frontend',
    test: () => makeResult({ rule_id: overrides.rule_id }),
    ...overrides,
  };
}

// ── buildV2LayerStages ────────────────────────────────────────────────────────

describe('buildV2LayerStages', () => {
  it('returns no rows for an empty result set', () => {
    expect(buildV2LayerStages([])).toEqual([]);
  });

  it('only includes layers that actually produced results', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'scope_configuration' })];
    const stages = buildV2LayerStages(results);
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toContain('L0');
  });

  it('orders layers L0 through L12', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'hygiene_integrity' }),
      makeResult({ rule_id: 'B', validation_layer: 'scope_configuration' }),
      makeResult({ rule_id: 'C', validation_layer: 'click_id_capture' }),
    ];
    const stages = buildV2LayerStages(results);
    expect(stages.map((s) => s.stage)).toEqual([
      expect.stringContaining('L0'),
      expect.stringContaining('L2'),
      expect.stringContaining('L12'),
    ]);
  });

  it('a layer with any fail is status fail and lists it as an issue', () => {
    const results = [
      makeResult({ rule_id: 'A', validation_layer: 'click_id_capture', status: 'pass' }),
      makeResult({ rule_id: 'B', validation_layer: 'click_id_capture', status: 'fail', technical_details: { found: 'gclid missing', expected: '', evidence: [] } }),
    ];
    const [stage] = buildV2LayerStages(results);
    expect(stage.status).toBe('fail');
    expect(stage.issues).toEqual([{ rule_id: 'B', label: 'gclid missing' }]);
  });

  it('a layer that is entirely skipped reports not_run', () => {
    const results = [makeResult({ rule_id: 'A', validation_layer: 'cross_domain_continuity', status: 'skipped' })];
    const [stage] = buildV2LayerStages(results);
    expect(stage.status).toBe('not_run');
  });
});

// ── buildV2PlatformBreakdown ────────────────────────────────────────────────────

describe('buildV2PlatformBreakdown', () => {
  it('marks an undeclared platform as not_included', () => {
    const googleAds = buildV2PlatformBreakdown([], ['meta'], []).find((p) => p.platform === 'Google Ads');
    expect(googleAds?.status).toBe('not_included');
  });

  it('marks a declared platform with no results as not_included', () => {
    const register = [makeRule({ id: 'L1.5', rule_id: 'GOOGLE_TAG', platform_scope: ['google_ads'] })];
    const breakdown = buildV2PlatformBreakdown([], ['google_ads'], register);
    const googleAds = breakdown.find((p) => p.platform === 'Google Ads');
    expect(googleAds?.status).toBe('not_included');
  });

  it('marks a declared platform healthy when all its rules pass', () => {
    const register = [
      makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', platform_scope: ['meta'] }),
      makeRule({ id: 'L2.4', rule_id: 'FBCLID_CAPTURED_AT_LANDING', platform_scope: ['meta'] }),
    ];
    const results = [
      makeResult({ rule_id: 'META_PIXEL_PRESENT', status: 'pass' }),
      makeResult({ rule_id: 'FBCLID_CAPTURED_AT_LANDING', status: 'pass' }),
    ];
    const breakdown = buildV2PlatformBreakdown(results, ['meta'], register);
    const meta = breakdown.find((p) => p.platform === 'Meta');
    expect(meta?.status).toBe('healthy');
    expect(meta?.failed_rules).toEqual([]);
  });

  it('marks a declared platform broken when most of its rules fail', () => {
    const register = [
      makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', platform_scope: ['meta'] }),
      makeRule({ id: 'L2.4', rule_id: 'FBCLID_CAPTURED_AT_LANDING', platform_scope: ['meta'] }),
    ];
    const results = [
      makeResult({ rule_id: 'META_PIXEL_PRESENT', status: 'fail' }),
      makeResult({ rule_id: 'FBCLID_CAPTURED_AT_LANDING', status: 'fail' }),
    ];
    const breakdown = buildV2PlatformBreakdown(results, ['meta'], register);
    const meta = breakdown.find((p) => p.platform === 'Meta');
    expect(meta?.status).toBe('broken');
    expect(meta?.failed_rules).toEqual(['META_PIXEL_PRESENT', 'FBCLID_CAPTURED_AT_LANDING']);
  });

  it('includes a "declared" platform_scope rule (L0.1) for every declared platform', () => {
    const register = [makeRule({ id: 'L0.1', rule_id: 'DECLARED_PLATFORM_HAS_TAG', platform_scope: 'declared' })];
    const results = [makeResult({ rule_id: 'DECLARED_PLATFORM_HAS_TAG', status: 'pass' })];
    const breakdown = buildV2PlatformBreakdown(results, ['google_ads', 'meta'], register);
    expect(breakdown.find((p) => p.platform === 'Google Ads')?.status).toBe('healthy');
    expect(breakdown.find((p) => p.platform === 'Meta')?.status).toBe('healthy');
  });

  it('excludes an "any" platform_scope rule from every platform-specific breakdown', () => {
    const register = [makeRule({ id: 'L1.1', rule_id: 'GTM_CONTAINER_LOADED', platform_scope: 'any' })];
    const results = [makeResult({ rule_id: 'GTM_CONTAINER_LOADED', status: 'fail' })];
    const breakdown = buildV2PlatformBreakdown(results, ['meta'], register);
    const meta = breakdown.find((p) => p.platform === 'Meta');
    expect(meta?.status).toBe('not_included'); // no meta-specific rules produced a result
  });

  it('returns a row for all 8 declarable platforms', () => {
    const breakdown = buildV2PlatformBreakdown([], [] as DeclaredPlatform[], []);
    expect(breakdown).toHaveLength(8);
    expect(breakdown.every((p) => p.status === 'not_included')).toBe(true);
  });

  // ── ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part A (A-W7) ────────────────────────

  it('an audit declaring openai produces an OpenAI row in the Platform Health Summary', () => {
    const register = [
      makeRule({ id: 'L1.17', rule_id: 'OPENAI_PIXEL_PRESENT', platform_scope: ['openai'] }),
      makeRule({ id: 'L2.13', rule_id: 'OPPREF_CAPTURED_AT_LANDING', platform_scope: ['openai'] }),
    ];
    const results = [
      makeResult({ rule_id: 'OPENAI_PIXEL_PRESENT', status: 'pass' }),
      makeResult({ rule_id: 'OPPREF_CAPTURED_AT_LANDING', status: 'pass' }),
    ];
    const breakdown = buildV2PlatformBreakdown(results, ['openai'], register);
    const openai = breakdown.find((p) => p.platform === 'OpenAI (ChatGPT Ads)');
    expect(openai).toBeDefined();
    expect(openai?.status).toBe('healthy');
  });

  it('an audit not declaring openai reports it Not Included, not Broken', () => {
    const register = [makeRule({ id: 'L1.17', rule_id: 'OPENAI_PIXEL_PRESENT', platform_scope: ['openai'] })];
    const breakdown = buildV2PlatformBreakdown([], ['meta'], register);
    const openai = breakdown.find((p) => p.platform === 'OpenAI (ChatGPT Ads)');
    expect(openai?.status).toBe('not_included');
  });

  // ── Platform Attribution & Determinism PRD Part A (A-W4) ──────────────────
  // Regression coverage for audit 14ab28ae: a 'declared'-scope rule (L0.1)
  // that fails for Meta only must not drag Google Ads or TikTok down with
  // it — each platform's own platform_outcomes entry decides its fate, not
  // the rule's shared scalar `status`.

  describe('platform_outcomes disaggregation (A-W4)', () => {
    const register = [
      makeRule({ id: 'L0.1', rule_id: 'DECLARED_PLATFORM_HAS_TAG', platform_scope: 'declared' }),
      makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', platform_scope: ['meta'] }),
      makeRule({ id: 'L2.4', rule_id: 'FBCLID_CAPTURED_AT_LANDING', platform_scope: ['meta'] }),
      makeRule({ id: 'L1.8', rule_id: 'TIKTOK_PIXEL_PRESENT', platform_scope: ['tiktok'] }),
      makeRule({ id: 'L2.5', rule_id: 'TTCLID_CAPTURED_AT_LANDING', platform_scope: ['tiktok'] }),
    ];

    it('L0.1 failing for Meta only leaves Google Ads/TikTok healthy, not at_risk', () => {
      const results = [
        makeResult({
          rule_id: 'DECLARED_PLATFORM_HAS_TAG',
          status: 'fail', // overall status stays 'fail' — it failed for Meta
          platform_outcomes: { google_ads: 'pass', meta: 'fail', tiktok: 'pass' },
        }),
        makeResult({ rule_id: 'META_PIXEL_PRESENT', status: 'fail' }),
        makeResult({ rule_id: 'FBCLID_CAPTURED_AT_LANDING', status: 'fail' }),
        makeResult({ rule_id: 'TIKTOK_PIXEL_PRESENT', status: 'pass' }),
        makeResult({ rule_id: 'TTCLID_CAPTURED_AT_LANDING', status: 'pass' }),
      ];
      const breakdown = buildV2PlatformBreakdown(results, ['google_ads', 'meta', 'tiktok'], register);

      const googleAds = breakdown.find((p) => p.platform === 'Google Ads')!;
      expect(googleAds.status).toBe('healthy');
      expect(googleAds.failed_rules).toEqual([]);

      const meta = breakdown.find((p) => p.platform === 'Meta')!;
      expect(meta.status).toBe('broken');
      expect(meta.failed_rules).toEqual(['DECLARED_PLATFORM_HAS_TAG', 'META_PIXEL_PRESENT', 'FBCLID_CAPTURED_AT_LANDING']);

      const tiktok = breakdown.find((p) => p.platform === 'TikTok')!;
      expect(tiktok.status).toBe('healthy'); // 0 of 3 failed — not "1 of 4" via the shared scalar
      expect(tiktok.failed_rules).toEqual([]);
    });

    it('a single-platform rule with no platform_outcomes behaves exactly as before (scalar fallback)', () => {
      const singlePlatformRegister = [makeRule({ id: 'L1.7', rule_id: 'META_PIXEL_PRESENT', platform_scope: ['meta'] })];
      const results = [makeResult({ rule_id: 'META_PIXEL_PRESENT', status: 'fail' })]; // no platform_outcomes at all
      const breakdown = buildV2PlatformBreakdown(results, ['meta'], singlePlatformRegister);
      const meta = breakdown.find((p) => p.platform === 'Meta')!;
      expect(meta.status).toBe('broken');
      expect(meta.failed_rules).toEqual(['META_PIXEL_PRESENT']);
    });

    it('a "declared"-scope rule with platform_outcomes absent falls back to the scalar status for every platform (not-yet-migrated rule)', () => {
      const results = [
        makeResult({ rule_id: 'DECLARED_PLATFORM_HAS_TAG', status: 'fail' }), // no platform_outcomes
        makeResult({ rule_id: 'META_PIXEL_PRESENT', status: 'pass' }),
        makeResult({ rule_id: 'FBCLID_CAPTURED_AT_LANDING', status: 'pass' }),
        makeResult({ rule_id: 'TIKTOK_PIXEL_PRESENT', status: 'pass' }),
        makeResult({ rule_id: 'TTCLID_CAPTURED_AT_LANDING', status: 'pass' }),
      ];
      const breakdown = buildV2PlatformBreakdown(results, ['google_ads', 'meta', 'tiktok'], register);
      // Every platform inherits the shared 'fail' scalar — the pre-fix behaviour.
      for (const platform of ['Google Ads', 'Meta', 'TikTok']) {
        expect(breakdown.find((p) => p.platform === platform)?.failed_rules).toContain('DECLARED_PLATFORM_HAS_TAG');
      }
    });
  });
});
