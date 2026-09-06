/**
 * Contradiction guard tests (Report Correctness Programme PRD Part A3/A4.5)
 * — each of the three minimum contradiction pairs the PRD names, reproduced
 * directly against synthetic ValidationResult objects rather than through
 * runRegister(), since the point is to test the guard's own logic in
 * isolation from any one rule's implementation.
 */
import { describe, it, expect } from 'vitest';
import { detectCaptureContradictions, flagCaptureContradictions } from '../contradictionGuard';
import type { ValidationResult, RuleStatus } from '@/types/audit';

function makeResult(rule_id: string, status: RuleStatus): ValidationResult {
  return {
    rule_id,
    validation_layer: 'click_id_capture',
    status,
    severity: 'critical',
    technical_details: { found: 'irrelevant for this test', expected: 'irrelevant for this test', evidence: [] },
  };
}

describe('detectCaptureContradictions', () => {
  it('fires when GCLID_CAPTURED_AT_LANDING fails while GCL_AW_COOKIE_PRESENT passes', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    const contradictions = detectCaptureContradictions(results);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].rule_id).toBe('GCLID_CAPTURED_AT_LANDING');
    expect(contradictions[0].contradicted_by_rule_id).toBe('GCL_AW_COOKIE_PRESENT');
  });

  it('fires when FBCLID_CAPTURED_AT_LANDING fails while FBP_AND_FBC_COOKIES_PRESENT passes', () => {
    const results = [makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('FBP_AND_FBC_COOKIES_PRESENT', 'pass')];
    const contradictions = detectCaptureContradictions(results);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].contradicted_by_rule_id).toBe('FBP_AND_FBC_COOKIES_PRESENT');
  });

  it('fires when any click-ID rule fails while CLICK_ID_WRITTEN_TO_DURABLE_STORAGE passes', () => {
    const results = [makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'), makeResult('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE', 'pass')];
    const contradictions = detectCaptureContradictions(results);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].rule_id).toBe('WBRAID_CAPTURED_AT_LANDING');
  });

  it('reproduces the Birkenstock 13795830 shape: 5 click-ID FAILs against 4 passing sibling rules', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('TTCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GCL_AW_COOKIE_PRESENT', 'pass'),
      makeResult('FBP_AND_FBC_COOKIES_PRESENT', 'pass'),
      makeResult('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE', 'pass'),
      makeResult('CONVERSION_LINKER_ENABLED', 'pass'),
    ];
    const contradictions = detectCaptureContradictions(results);
    // gclid: contradicted by both GCL_AW_COOKIE_PRESENT and CLICK_ID_WRITTEN_TO_DURABLE_STORAGE
    // fbclid: contradicted by both FBP_AND_FBC_COOKIES_PRESENT and CLICK_ID_WRITTEN_TO_DURABLE_STORAGE
    // gbraid/wbraid/ttclid: contradicted only by CLICK_ID_WRITTEN_TO_DURABLE_STORAGE
    expect(contradictions.length).toBeGreaterThanOrEqual(5);
    expect(new Set(contradictions.map((c) => c.rule_id))).toEqual(new Set([
      'GCLID_CAPTURED_AT_LANDING', 'GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING',
      'FBCLID_CAPTURED_AT_LANDING', 'TTCLID_CAPTURED_AT_LANDING',
    ]));
  });

  it('does not fire when the sibling rule also failed (no contradiction) or is absent from the run', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'fail')];
    expect(detectCaptureContradictions(results)).toHaveLength(0);
    expect(detectCaptureContradictions([makeResult('GCLID_CAPTURED_AT_LANDING', 'fail')])).toHaveLength(0);
  });

  it('does not fire on a consistent, correctly-instrumented run', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    expect(detectCaptureContradictions(results)).toHaveLength(0);
  });
});

describe('flagCaptureContradictions', () => {
  it('appends a contradiction line to the failing result\'s evidence without mutating the input', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    const flagged = flagCaptureContradictions(results);
    expect(results[0].technical_details.evidence).toHaveLength(0); // input untouched
    const flaggedGclid = flagged.find((r) => r.rule_id === 'GCLID_CAPTURED_AT_LANDING');
    expect(flaggedGclid?.technical_details.evidence.some((e) => e.startsWith('⚠ CONTRADICTION:'))).toBe(true);
  });

  it('returns the same array reference when nothing contradicts', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass')];
    expect(flagCaptureContradictions(results)).toBe(results);
  });
});
