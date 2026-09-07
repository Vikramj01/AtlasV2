/**
 * Click-ID contention tests (Click-ID Contention, Contradiction Guard &
 * Settle Enforcement PRD W1 — minimum option).
 */
import { describe, it, expect } from 'vitest';
import { partitionClickIdContention } from '../clickIdContention';
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

const ALL_GOOGLE_INJECTED = {
  urlParams: { gclid: 'test_gclid_1', gbraid: 'test_gbraid_1', wbraid: 'test_wbraid_1' },
};

describe('partitionClickIdContention', () => {
  it('reproduces the 7d64f5e9 shape: gclid captured, gbraid/wbraid lose the contention — routed to could_not_be_assessed, not left as CRITICAL fails', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
    ];
    const { assessable, unassessable } = partitionClickIdContention(results, ALL_GOOGLE_INJECTED);

    expect(assessable.map((r) => r.rule_id)).toEqual(['GCLID_CAPTURED_AT_LANDING']);
    expect(new Set(unassessable.map((f) => f.rule_id))).toEqual(
      new Set(['GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING']),
    );
    expect(unassessable[0].reason).toContain('same platform family');
  });

  it('does not fire when only one Google-family member was injected (no contention possible)', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'fail')];
    const { assessable, unassessable } = partitionClickIdContention(results, { urlParams: { gclid: 'test_gclid_1' } });
    expect(assessable).toEqual(results);
    expect(unassessable).toHaveLength(0);
  });

  it('does not fire when every family member failed (a real capture failure, not contention)', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'fail'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'fail'),
    ];
    const { assessable, unassessable } = partitionClickIdContention(results, ALL_GOOGLE_INJECTED);
    expect(assessable).toEqual(results);
    expect(unassessable).toHaveLength(0);
  });

  it('does not fire when every family member captured (nothing lost to contention)', () => {
    const results = [
      makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('GBRAID_CAPTURED_AT_LANDING', 'pass'),
      makeResult('WBRAID_CAPTURED_AT_LANDING', 'pass'),
    ];
    const { assessable, unassessable } = partitionClickIdContention(results, ALL_GOOGLE_INJECTED);
    expect(assessable).toEqual(results);
    expect(unassessable).toHaveLength(0);
  });

  it('does not treat cross-family injection (gclid + ttclid) as contention (PRD §2.3)', () => {
    const results = [makeResult('GCLID_CAPTURED_AT_LANDING', 'pass'), makeResult('TTCLID_CAPTURED_AT_LANDING', 'fail')];
    const { assessable, unassessable } = partitionClickIdContention(
      results,
      { urlParams: { gclid: 'test_gclid_1', ttclid: 'test_ttclid_1' } },
    );
    expect(assessable).toEqual(results);
    expect(unassessable).toHaveLength(0);
  });

  it('single-member families (Meta/TikTok/Microsoft/LinkedIn) never contend with themselves', () => {
    const results = [makeResult('FBCLID_CAPTURED_AT_LANDING', 'fail')];
    const { assessable, unassessable } = partitionClickIdContention(results, { urlParams: { fbclid: 'test_fbclid_1' } });
    expect(assessable).toEqual(results);
    expect(unassessable).toHaveLength(0);
  });
});
