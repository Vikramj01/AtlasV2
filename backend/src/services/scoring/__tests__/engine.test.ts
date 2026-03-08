/**
 * Scoring Engine Tests
 * Tests all 4 scores across boundary conditions, empty inputs, and partial rule sets.
 */
import { describe, it, expect } from 'vitest';
import { calculateScores } from '../engine';
import type { ValidationResult } from '@/types/audit';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(
  rule_id: string,
  status: 'pass' | 'fail' | 'warning' = 'pass',
): ValidationResult {
  return {
    rule_id,
    validation_layer: 'parameter_completeness',
    status,
    severity: 'high',
    technical_details: { found: 'x', expected: 'y', evidence: [] },
  };
}

/** Build a result set where every rule passes. */
function allPass(ruleIds: string[]): ValidationResult[] {
  return ruleIds.map((id) => makeResult(id, 'pass'));
}

/** Build a result set where every rule fails. */
function allFail(ruleIds: string[]): ValidationResult[] {
  return ruleIds.map((id) => makeResult(id, 'fail'));
}

// All 26 rule IDs for full-run tests
const ALL_RULES = [
  'GA4_PURCHASE_EVENT_FIRED',
  'META_PIXEL_PURCHASE_EVENT_FIRED',
  'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
  'SGTM_SERVER_EVENT_FIRED',
  'DATALAYER_POPULATED',
  'GTM_CONTAINER_LOADED',
  'PAGE_VIEW_EVENT_FIRED',
  'ADD_TO_CART_EVENT_FIRED',
  'TRANSACTION_ID_PRESENT',
  'VALUE_PARAMETER_PRESENT',
  'CURRENCY_PARAMETER_PRESENT',
  'GCLID_CAPTURED_AT_LANDING',
  'FBCLID_CAPTURED_AT_LANDING',
  'EVENT_ID_GENERATED',
  'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
  'PHONE_CAPTURED_FOR_CAPI',
  'ITEMS_ARRAY_POPULATED',
  'USER_ID_PRESENT',
  'COUPON_CAPTURED_IF_USED',
  'SHIPPING_CAPTURED',
  'GCLID_PERSISTS_TO_CONVERSION',
  'FBCLID_PERSISTS_TO_CONVERSION',
  'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
  'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
  'USER_DATA_NORMALIZED_CONSISTENTLY',
  'PII_PROPERLY_HASHED',
];

// ── 1. Conversion Signal Health ────────────────────────────────────────────────

describe('Conversion Signal Health', () => {
  it('returns 100 when all rules pass', () => {
    const { conversion_signal_health } = calculateScores(allPass(ALL_RULES));
    expect(conversion_signal_health).toBe(100);
  });

  it('returns 0 when all rules fail', () => {
    const { conversion_signal_health } = calculateScores(allFail(ALL_RULES));
    expect(conversion_signal_health).toBe(0);
  });

  it('returns 0 when given an empty result set', () => {
    const { conversion_signal_health } = calculateScores([]);
    expect(conversion_signal_health).toBe(0);
  });

  it('scores 50 when exactly half the rules pass', () => {
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass'),
      makeResult('META_PIXEL_PURCHASE_EVENT_FIRED', 'fail'),
    ];
    const { conversion_signal_health } = calculateScores(results);
    expect(conversion_signal_health).toBe(50);
  });

  it('rounds to nearest integer', () => {
    // 1 out of 3 = 33.33… → rounds to 33
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass'),
      makeResult('META_PIXEL_PURCHASE_EVENT_FIRED', 'fail'),
      makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'fail'),
    ];
    const { conversion_signal_health } = calculateScores(results);
    expect(conversion_signal_health).toBe(33);
  });

  it('counts warnings as non-passing', () => {
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'warning'),
      makeResult('META_PIXEL_PURCHASE_EVENT_FIRED', 'pass'),
    ];
    const { conversion_signal_health } = calculateScores(results);
    expect(conversion_signal_health).toBe(50);
  });

  it('scores against subset when not all 26 rules are run', () => {
    // 2 of 3 rules pass → 67
    const results = [
      makeResult('GA4_PURCHASE_EVENT_FIRED', 'pass'),
      makeResult('META_PIXEL_PURCHASE_EVENT_FIRED', 'pass'),
      makeResult('GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'fail'),
    ];
    expect(calculateScores(results).conversion_signal_health).toBe(67);
  });
});

// ── 2. Attribution Risk Level ──────────────────────────────────────────────────

describe('Attribution Risk Level', () => {
  const ATTR_RULES = ['GCLID_CAPTURED_AT_LANDING', 'FBCLID_CAPTURED_AT_LANDING', 'TRANSACTION_ID_PRESENT'];

  it('returns Low when all 3 attribution rules pass', () => {
    expect(calculateScores(allPass(ATTR_RULES)).attribution_risk_level).toBe('Low');
  });

  it('returns Critical when all 3 attribution rules fail', () => {
    expect(calculateScores(allFail(ATTR_RULES)).attribution_risk_level).toBe('Critical');
  });

  it('returns High when 2 attribution rules fail', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
    ];
    expect(calculateScores(results).attribution_risk_level).toBe('High');
  });

  it('returns Medium when exactly 1 attribution rule fails', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
    ];
    expect(calculateScores(results).attribution_risk_level).toBe('Medium');
  });

  it('returns Low when no attribution rules are in the result set', () => {
    // Only non-attribution rules run (e.g. platform-filtered run)
    const results = allPass(['GA4_PURCHASE_EVENT_FIRED', 'DATALAYER_POPULATED']);
    expect(calculateScores(results).attribution_risk_level).toBe('Low');
  });

  it('scores correctly with only 2 of 3 attribution rules present', () => {
    // Both present rules fail → all applicable fail → Critical
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('TRANSACTION_ID_PRESENT', 'fail'),
    ];
    expect(calculateScores(results).attribution_risk_level).toBe('Critical');
  });

  it('treats warnings as non-passing for attribution risk', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'warning'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('TRANSACTION_ID_PRESENT', 'pass'),
    ];
    // 1 non-pass → Medium
    expect(calculateScores(results).attribution_risk_level).toBe('Medium');
  });
});

// ── 3. Optimization Strength ───────────────────────────────────────────────────

describe('Optimization Strength', () => {
  const OPT_RULES = [
    'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
    'PHONE_CAPTURED_FOR_CAPI',
    'USER_ID_PRESENT',
    'ITEMS_ARRAY_POPULATED',
  ];

  it('returns Strong when all 4 optimization rules pass', () => {
    expect(calculateScores(allPass(OPT_RULES)).optimization_strength).toBe('Strong');
  });

  it('returns Weak when all 4 optimization rules fail', () => {
    expect(calculateScores(allFail(OPT_RULES)).optimization_strength).toBe('Weak');
  });

  it('returns Moderate when exactly half pass (2 of 4)', () => {
    const results = [
      makeResult('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'pass'),
      makeResult('PHONE_CAPTURED_FOR_CAPI', 'pass'),
      makeResult('USER_ID_PRESENT', 'fail'),
      makeResult('ITEMS_ARRAY_POPULATED', 'fail'),
    ];
    expect(calculateScores(results).optimization_strength).toBe('Moderate');
  });

  it('returns Moderate when more than half pass (3 of 4)', () => {
    const results = [
      makeResult('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'pass'),
      makeResult('PHONE_CAPTURED_FOR_CAPI', 'pass'),
      makeResult('USER_ID_PRESENT', 'pass'),
      makeResult('ITEMS_ARRAY_POPULATED', 'fail'),
    ];
    expect(calculateScores(results).optimization_strength).toBe('Moderate');
  });

  it('returns Weak when fewer than half pass (1 of 4)', () => {
    const results = [
      makeResult('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'pass'),
      makeResult('PHONE_CAPTURED_FOR_CAPI', 'fail'),
      makeResult('USER_ID_PRESENT', 'fail'),
      makeResult('ITEMS_ARRAY_POPULATED', 'fail'),
    ];
    expect(calculateScores(results).optimization_strength).toBe('Weak');
  });

  it('returns Moderate when no optimization rules are in the result set', () => {
    const results = allPass(['GA4_PURCHASE_EVENT_FIRED']);
    expect(calculateScores(results).optimization_strength).toBe('Moderate');
  });

  it('handles partial rule sets — 1 of 2 present passes → Moderate', () => {
    const results = [
      makeResult('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'pass'),
      makeResult('PHONE_CAPTURED_FOR_CAPI', 'fail'),
    ];
    // 1 of 2 applicable = 50% → ceil(2/2)=1 → pass >= threshold → Moderate
    expect(calculateScores(results).optimization_strength).toBe('Moderate');
  });
});

// ── 4. Data Consistency Score ──────────────────────────────────────────────────

describe('Data Consistency Score', () => {
  const CONSISTENCY_RULES = ['EVENT_ID_GENERATED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER'];

  it('returns High when both consistency rules pass', () => {
    expect(calculateScores(allPass(CONSISTENCY_RULES)).data_consistency_score).toBe('High');
  });

  it('returns Low when both consistency rules fail', () => {
    expect(calculateScores(allFail(CONSISTENCY_RULES)).data_consistency_score).toBe('Low');
  });

  it('returns Medium when 1 of 2 consistency rules passes', () => {
    const results = [
      makeResult('EVENT_ID_GENERATED', 'pass'),
      makeResult('EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER', 'fail'),
    ];
    expect(calculateScores(results).data_consistency_score).toBe('Medium');
  });

  it('returns High when no consistency rules are in the result set', () => {
    const results = allPass(['GA4_PURCHASE_EVENT_FIRED']);
    expect(calculateScores(results).data_consistency_score).toBe('High');
  });

  it('returns High when only one consistency rule is present and it passes', () => {
    // 1 applicable, 1 pass → consistencyPassCount === consistencyApplicable → High
    const results = [makeResult('EVENT_ID_GENERATED', 'pass')];
    expect(calculateScores(results).data_consistency_score).toBe('High');
  });

  it('returns Low when only one consistency rule is present and it fails', () => {
    const results = [makeResult('EVENT_ID_GENERATED', 'fail')];
    expect(calculateScores(results).data_consistency_score).toBe('Low');
  });
});

// ── 5. Full-run integration checks ────────────────────────────────────────────

describe('Full 26-rule runs', () => {
  it('all passing → perfect scores', () => {
    const scores = calculateScores(allPass(ALL_RULES));
    expect(scores.conversion_signal_health).toBe(100);
    expect(scores.attribution_risk_level).toBe('Low');
    expect(scores.optimization_strength).toBe('Strong');
    expect(scores.data_consistency_score).toBe('High');
  });

  it('all failing → worst scores', () => {
    const scores = calculateScores(allFail(ALL_RULES));
    expect(scores.conversion_signal_health).toBe(0);
    expect(scores.attribution_risk_level).toBe('Critical');
    expect(scores.optimization_strength).toBe('Weak');
    expect(scores.data_consistency_score).toBe('Low');
  });

  it('returns all 4 score keys in the result object', () => {
    const scores = calculateScores(allPass(ALL_RULES));
    expect(scores).toHaveProperty('conversion_signal_health');
    expect(scores).toHaveProperty('attribution_risk_level');
    expect(scores).toHaveProperty('optimization_strength');
    expect(scores).toHaveProperty('data_consistency_score');
  });
});
