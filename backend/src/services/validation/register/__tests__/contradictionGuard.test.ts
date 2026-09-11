/**
 * Contradiction guard tests (Click-ID Contention, Contradiction Guard &
 * Settle Enforcement PRD W2) — reproduced directly against synthetic
 * ValidationResult objects rather than through runRegister(), since the
 * point is to test the guard's own logic in isolation from any one rule's
 * implementation.
 */
import { describe, it, expect } from 'vitest';
import { detectCaptureContradictions, partitionContradictions } from '../contradictionGuard';
import type { ValidationResult, RuleStatus } from '@/types/audit';

function makeResult(rule_id: string, status: RuleStatus, evidence: string[] = []): ValidationResult {
  return {
    rule_id,
    validation_layer: 'click_id_capture',
    status,
    severity: 'critical',
    technical_details: { found: 'irrelevant for this test', expected: 'irrelevant for this test', evidence },
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

  it('fires when GBRAID/WBRAID_CAPTURED_AT_LANDING fail while GCL_AW_COOKIE_PRESENT passes (W2 — same Google family, not just gclid)', () => {
    const results = [
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GCL_AW_COOKIE_PRESENT', 'pass'),
    ];
    const contradictions = detectCaptureContradictions(results);
    expect(new Set(contradictions.map((c) => c.rule_id))).toEqual(
      new Set(['GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING']),
    );
  });

  it('fires when FBCLID_CAPTURED_AT_LANDING fails while _fbc is specifically present, regardless of FBC_COOKIE_PRESENT\'s own status (W2; FBC_COOKIE_PRESENT split out by the Pre-Connection Scan Confidence Tiering PRD §10.4 and always status: \'skipped\' — its evidence, not its status, is what this guard reads)', () => {
    const results = [
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBC_COOKIE_PRESENT', 'skipped', ['_fbc present: true']),
    ];
    const contradictions = detectCaptureContradictions(results);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].contradicted_by_rule_id).toBe('FBC_COOKIE_PRESENT');
  });

  it('does not fire on fbclid when FBC_COOKIE_PRESENT reports _fbc absent', () => {
    const results = [
      makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('FBC_COOKIE_PRESENT', 'skipped', ['_fbc present: false']),
    ];
    expect(detectCaptureContradictions(results)).toHaveLength(0);
  });

  it('no longer fires against the circular CLICK_ID_WRITTEN_TO_DURABLE_STORAGE aggregate (W2.1 — the fixed defect)', () => {
    const results = [
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('TTCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE', 'pass'),
    ];
    expect(detectCaptureContradictions(results)).toHaveLength(0);
  });

  it('reproduces the corrected 7d64f5e9 shape: no contradiction once gbraid/wbraid/ttclid/msclkid have no aggregate pairing left standing', () => {
    // gclid passed for real (delimited match in _gcl_ls); gbraid/wbraid/
    // ttclid/msclkid failed. GCL_AW_COOKIE_PRESENT passed (proves a Google
    // click ID resolved — contradicts the two Google-family fails).
    // ttclid/msclkid have no aggregate pairing at all (correctly omitted).
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('TTCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('MSCLKID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GCL_AW_COOKIE_PRESENT', 'pass'),
      makeResult('FBC_COOKIE_PRESENT', 'skipped', ['_fbc present: false']),
      makeResult('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE', 'pass'),
    ];
    const contradictions = detectCaptureContradictions(results);
    // gbraid/wbraid ARE still contradicted here (no click-ID contention
    // partition has run in this isolated test) — but ttclid/msclkid are
    // never touched, since neither has an aggregate pairing.
    expect(new Set(contradictions.map((c) => c.rule_id))).toEqual(
      new Set(['GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING']),
    );
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

describe('partitionContradictions', () => {
  it('routes a fired contradiction to could_not_be_assessed rather than annotating it in place (W2.2)', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'), makeResult('GCL_AW_COOKIE_PRESENT', 'pass')];
    const { assessable, unassessable } = partitionContradictions(results);

    expect(assessable.map((r) => r.rule_id)).toEqual(['GCL_AW_COOKIE_PRESENT']);
    expect(unassessable).toHaveLength(1);
    expect(unassessable[0].rule_id).toBe('GCLID_CAPTURED_AT_LANDING');
    expect(unassessable[0].reason).toContain('GCL_AW_COOKIE_PRESENT');

    // The input is never mutated, and no evidence line is ever appended —
    // the whole result moves out, it's never decorated in place.
    expect(results[0].technical_details.evidence).toHaveLength(0);
  });

  it('returns every result assessable and an empty unassessable list when nothing contradicts', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass')];
    const { assessable, unassessable } = partitionContradictions(results);
    expect(assessable).toBe(results);
    expect(unassessable).toHaveLength(0);
  });
});
