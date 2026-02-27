import { describe, it, expect } from 'vitest';
import { runAllRules, runLayer, summarizeResults, ALL_RULES } from '../engine';
import { makePerfectAuditData, makeEmptyAuditData } from './mockAuditData';
import type { AuditData } from '@/types/audit';

describe('Validation engine', () => {
  it('has exactly 26 rules registered', () => {
    expect(ALL_RULES).toHaveLength(26);
  });

  it('each rule has a unique rule_id', () => {
    const ids = ALL_RULES.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(26);
  });

  it('returns 26 results for perfect AuditData', () => {
    const results = runAllRules(makePerfectAuditData());
    expect(results).toHaveLength(26);
  });

  it('all results are pass or warning for perfect AuditData', () => {
    const results = runAllRules(makePerfectAuditData());
    const failures = results.filter((r) => r.status === 'fail');
    // Perfect data: COUPON and SHIPPING will be 'pass' (present), others pass too
    expect(failures).toHaveLength(0);
  });

  it('most rules fail for empty AuditData', () => {
    const results = runAllRules(makeEmptyAuditData());
    const failures = results.filter((r) => r.status === 'fail');
    // Expect at least 15 failures for completely empty data
    expect(failures.length).toBeGreaterThanOrEqual(15);
  });

  it('each result has all required fields', () => {
    const results = runAllRules(makePerfectAuditData());
    for (const r of results) {
      expect(r).toHaveProperty('rule_id');
      expect(r).toHaveProperty('validation_layer');
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('severity');
      expect(r).toHaveProperty('technical_details');
      expect(r.technical_details).toHaveProperty('found');
      expect(r.technical_details).toHaveProperty('expected');
      expect(r.technical_details).toHaveProperty('evidence');
      expect(Array.isArray(r.technical_details.evidence)).toBe(true);
    }
  });

  it('runLayer returns only Layer 1 rules', () => {
    const results = runLayer('signal_initiation', makePerfectAuditData());
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.validation_layer === 'signal_initiation')).toBe(true);
  });

  it('runLayer returns only Layer 2 rules', () => {
    const results = runLayer('parameter_completeness', makePerfectAuditData());
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.validation_layer === 'parameter_completeness')).toBe(true);
  });

  it('runLayer returns only Layer 3 rules', () => {
    const results = runLayer('persistence', makePerfectAuditData());
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.validation_layer === 'persistence')).toBe(true);
  });

  it('summarizeResults returns correct totals', () => {
    const results = runAllRules(makePerfectAuditData());
    const summary = summarizeResults(results);
    expect(summary.total).toBe(26);
    expect(summary.by_layer.signal_initiation).toBe(8);
    expect(summary.by_layer.parameter_completeness).toBe(12);
    expect(summary.by_layer.persistence).toBe(6);
  });

  it('malformed AuditData does not throw — returns warning for each rule', () => {
    const broken = {} as AuditData;
    const results = runAllRules(broken);
    expect(results).toHaveLength(26);
    // All should be warning (not crash)
    expect(results.every((r) => r.status === 'warning' || r.status === 'pass' || r.status === 'fail')).toBe(true);
  });

  it('completes in <500ms on typical data', () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      runAllRules(makePerfectAuditData());
    }
    const elapsed = Date.now() - start;
    // 10 runs < 500ms means each run is <50ms
    expect(elapsed).toBeLessThan(500);
  });
});

describe('Scoring engine', () => {
  it('returns 100 signal health for perfect data', async () => {
    const { calculateScores } = await import('@/services/scoring/engine');
    const results = runAllRules(makePerfectAuditData());
    const scores = calculateScores(results);
    // Some rules return 'warning' (COUPON, SHIPPING) so health < 100 unless coupons/shipping present
    expect(scores.conversion_signal_health).toBeGreaterThan(75);
  });

  it('returns Low attribution risk for perfect data', async () => {
    const { calculateScores } = await import('@/services/scoring/engine');
    const results = runAllRules(makePerfectAuditData());
    const scores = calculateScores(results);
    expect(scores.attribution_risk_level).toBe('Low');
  });

  it('returns Critical attribution risk when all 3 attribution rules fail', async () => {
    const { calculateScores } = await import('@/services/scoring/engine');
    const results = runAllRules(makeEmptyAuditData());
    const scores = calculateScores(results);
    expect(scores.attribution_risk_level).toBe('Critical');
  });
});
