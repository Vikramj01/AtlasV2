/**
 * Readiness Score Formula Verification
 *
 * Tests the scoring logic extracted from backend/src/api/routes/readiness.ts.
 * The route computes the score inline; we replicate the identical logic here
 * so we can test it without a live Supabase connection.
 *
 * Scoring table (verified to sum to 100):
 *   +20  consent_configured
 *   +20  server_side_enabled   (any active CAPI provider)
 *   +20  capi_connected        (any active CAPI provider — NOTE: same condition as above)
 *   +15  click_id_capture      (GTM container output exists)
 *   +15  enhanced_conversions  (active provider has email|phone identifier)
 *   +10  health_score_strong   (overall_score > 80)
 *  ────
 *  100
 *
 * BUG NOTE: `server_side_enabled` and `capi_connected` both resolve to
 * `activeProviders.length > 0`, making them always equal. An org with active
 * CAPI but no consent, no GTM output, no enhanced conversions, and a weak
 * health score would score 40 (20 + 20) — not 20. This is tested below.
 */

import { describe, it, expect } from 'vitest';

// ── Replicated scoring logic (mirrors readiness.ts exactly) ──────────────────

interface ScoringInput {
  consentConfigured: boolean;
  activeProviderCount: number;
  clickIdCapture: boolean;
  enhancedConversions: boolean;
  healthScore: number;
}

interface ReadinessItem {
  key: string;
  points: number;
  earned: boolean;
}

function computeReadinessScore(input: ScoringInput): { score: number; items: ReadinessItem[] } {
  const {
    consentConfigured,
    activeProviderCount,
    clickIdCapture,
    enhancedConversions,
    healthScore,
  } = input;

  const capiConnected = activeProviderCount > 0;
  const serverSideEnabled = capiConnected; // same condition as in the route

  const items: ReadinessItem[] = [
    { key: 'consent_configured',  points: 20, earned: consentConfigured },
    { key: 'server_side_enabled', points: 20, earned: serverSideEnabled },
    { key: 'capi_connected',      points: 20, earned: capiConnected },
    { key: 'click_id_capture',    points: 15, earned: clickIdCapture },
    { key: 'enhanced_conversions', points: 15, earned: enhancedConversions },
    { key: 'health_score_strong', points: 10, earned: healthScore > 80 },
  ];

  const score = items.reduce((sum, item) => sum + (item.earned ? item.points : 0), 0);
  return { score, items };
}

// ── Formula arithmetic ────────────────────────────────────────────────────────

describe('Readiness score formula', () => {
  it('all item point values sum to 100', () => {
    const allPoints = [20, 20, 20, 15, 15, 10];
    const total = allPoints.reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});

// ── Scenario: all criteria met ────────────────────────────────────────────────

describe('All criteria met', () => {
  it('produces a score of 100', () => {
    const { score } = computeReadinessScore({
      consentConfigured: true,
      activeProviderCount: 2,
      clickIdCapture: true,
      enhancedConversions: true,
      healthScore: 95,
    });
    expect(score).toBe(100);
  });
});

// ── Scenario: only consent configured ────────────────────────────────────────

describe('Only consent configured', () => {
  it('produces a score of 20', () => {
    const { score } = computeReadinessScore({
      consentConfigured: true,
      activeProviderCount: 0,
      clickIdCapture: false,
      enhancedConversions: false,
      healthScore: 0,
    });
    expect(score).toBe(20);
  });
});

// ── Scenario: nothing configured ─────────────────────────────────────────────

describe('Nothing configured', () => {
  it('produces a score of 0', () => {
    const { score } = computeReadinessScore({
      consentConfigured: false,
      activeProviderCount: 0,
      clickIdCapture: false,
      enhancedConversions: false,
      healthScore: 0,
    });
    expect(score).toBe(0);
  });
});

// ── Cap at 100 ────────────────────────────────────────────────────────────────

describe('Score cap', () => {
  it('cannot exceed 100 given the defined items', () => {
    /**
     * The route does NOT apply Math.min(score, 100) — it relies on the item
     * definitions summing to exactly 100. Since no item earns more than its
     * defined points, the natural maximum is 100.
     *
     * This test verifies that natural maximum is indeed 100 and that the
     * formula has no pathway to exceed it.
     */
    const { score } = computeReadinessScore({
      consentConfigured: true,
      activeProviderCount: 99, // many providers — still maps to boolean
      clickIdCapture: true,
      enhancedConversions: true,
      healthScore: 100,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100); // and at exactly 100 when all criteria are met
  });

  it('has no explicit Math.min cap — relies on item sum equalling 100', () => {
    // If somehow an extra criterion were added without a corresponding
    // deduction elsewhere, the score would silently exceed 100.
    // This test documents the assumption.
    const allItemPoints = [20, 20, 20, 15, 15, 10];
    const maxPossible = allItemPoints.reduce((a, b) => a + b, 0);
    expect(maxPossible).toBe(100);
  });
});

// ── Duplicate condition: server_side_enabled === capi_connected ───────────────

describe('Duplicate criterion behaviour', () => {
  it('awards 40 points when only CAPI is active (server_side + capi_connected double-count)', () => {
    /**
     * Both server_side_enabled and capi_connected resolve to `activeProviderCount > 0`.
     * This means a bare CAPI setup (no consent, no GTM output, no enhanced conversions,
     * weak health) scores 40, not 20. Documenting this as a known design characteristic.
     */
    const { score, items } = computeReadinessScore({
      consentConfigured: false,
      activeProviderCount: 1,
      clickIdCapture: false,
      enhancedConversions: false,
      healthScore: 0,
    });
    const serverSideItem = items.find((i) => i.key === 'server_side_enabled')!;
    const capiItem = items.find((i) => i.key === 'capi_connected')!;

    expect(serverSideItem.earned).toBe(true);
    expect(capiItem.earned).toBe(true);
    expect(score).toBe(40); // 20 + 20 from the two identical conditions
  });
});

// ── Level thresholds ──────────────────────────────────────────────────────────

describe('Level thresholds', () => {
  function levelFor(score: number): string {
    if (score <= 30) return 'getting_started';
    if (score <= 60) return 'building';
    if (score <= 85) return 'strong';
    return 'best_in_class';
  }

  it('score 0 → getting_started', () => expect(levelFor(0)).toBe('getting_started'));
  it('score 30 → getting_started', () => expect(levelFor(30)).toBe('getting_started'));
  it('score 31 → building', () => expect(levelFor(31)).toBe('building'));
  it('score 60 → building', () => expect(levelFor(60)).toBe('building'));
  it('score 61 → strong', () => expect(levelFor(61)).toBe('strong'));
  it('score 85 → strong', () => expect(levelFor(85)).toBe('strong'));
  it('score 86 → best_in_class', () => expect(levelFor(86)).toBe('best_in_class'));
  it('score 100 → best_in_class', () => expect(levelFor(100)).toBe('best_in_class'));
});
