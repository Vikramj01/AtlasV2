import { describe, it, expect } from 'vitest';
import {
  computeTierStats,
  evaluateDeliveryGate,
  TIER_BY_IDENTITY_METHOD,
  TIER3_RATE_THRESHOLD_PERCENT,
  MIN_SAMPLE_FOR_GATE,
} from '../deliveryGate';
import type { OutcomeIdentityMethod } from '@/types/outcomes';

describe('TIER_BY_IDENTITY_METHOD', () => {
  it('maps click_id to tier 1', () => {
    expect(TIER_BY_IDENTITY_METHOD.click_id).toBe(1);
  });

  it('maps both hashed methods to tier 2', () => {
    expect(TIER_BY_IDENTITY_METHOD.hashed_email).toBe(2);
    expect(TIER_BY_IDENTITY_METHOD.hashed_phone).toBe(2);
  });

  it('maps unresolved to tier 3', () => {
    expect(TIER_BY_IDENTITY_METHOD.unresolved).toBe(3);
  });
});

describe('computeTierStats', () => {
  it('returns all zeros and a null rate for an empty list', () => {
    expect(computeTierStats([])).toEqual({ total: 0, tier1: 0, tier2: 0, tier3: 0, tier3_rate_percent: null });
  });

  it('counts each tier correctly across a mixed set', () => {
    const methods: OutcomeIdentityMethod[] = ['click_id', 'click_id', 'hashed_email', 'hashed_phone', 'unresolved'];
    const stats = computeTierStats(methods);
    expect(stats).toEqual({ total: 5, tier1: 2, tier2: 2, tier3: 1, tier3_rate_percent: 20 });
  });

  it('computes a 100% tier-3 rate when every record is unresolved', () => {
    const stats = computeTierStats(['unresolved', 'unresolved']);
    expect(stats.tier3_rate_percent).toBe(100);
  });

  it('computes a 0% tier-3 rate when nothing is unresolved', () => {
    const stats = computeTierStats(['click_id', 'hashed_email']);
    expect(stats.tier3_rate_percent).toBe(0);
  });
});

describe('evaluateDeliveryGate', () => {
  it('never disables below the minimum sample size, however bad the rate', () => {
    const stats = computeTierStats(Array(MIN_SAMPLE_FOR_GATE - 1).fill('unresolved'));
    expect(evaluateDeliveryGate(stats)).toEqual({ shouldDisable: false, reason: null });
  });

  it('disables once the sample size is met and the rate exceeds threshold', () => {
    const total = MIN_SAMPLE_FOR_GATE;
    const unresolvedCount = Math.ceil(total * (TIER3_RATE_THRESHOLD_PERCENT / 100)) + 1;
    const methods: OutcomeIdentityMethod[] = [
      ...Array(unresolvedCount).fill('unresolved'),
      ...Array(total - unresolvedCount).fill('click_id'),
    ];
    const decision = evaluateDeliveryGate(computeTierStats(methods));
    expect(decision.shouldDisable).toBe(true);
    expect(decision.reason).toMatch(/could not be matched to an identity/);
    expect(decision.reason).toMatch(/automatically disabled/);
  });

  it('does not disable exactly at the threshold — only strictly above it', () => {
    // 3 of 10 = 30% = TIER3_RATE_THRESHOLD_PERCENT exactly.
    const methods: OutcomeIdentityMethod[] = [
      ...Array(3).fill('unresolved'),
      ...Array(7).fill('click_id'),
    ];
    expect(evaluateDeliveryGate(computeTierStats(methods)).shouldDisable).toBe(false);
  });

  it('never disables when the tier-3 rate is healthy, regardless of sample size', () => {
    const methods: OutcomeIdentityMethod[] = Array(500).fill('click_id');
    expect(evaluateDeliveryGate(computeTierStats(methods)).shouldDisable).toBe(false);
  });

  it('the reason names the exact rate and sample size', () => {
    const methods: OutcomeIdentityMethod[] = [
      ...Array(4).fill('unresolved'),
      ...Array(6).fill('click_id'),
    ];
    const decision = evaluateDeliveryGate(computeTierStats(methods));
    expect(decision.reason).toMatch(/40\.0%/);
    expect(decision.reason).toMatch(/last 10 records/);
  });
});
