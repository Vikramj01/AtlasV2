import { describe, it, expect } from 'vitest';
import {
  checkNativeIdDerivesFromCanonical,
  checkRetriesExhaustedUnconfirmed,
  checkIdentityIntegrity,
  type IdentityCheckRow,
} from '../identityIntegrityRules';

function baseRow(overrides: Partial<IdentityCheckRow> = {}): IdentityCheckRow {
  return {
    atlas_event_id: 'canonical-evt-001',
    event_id: 'canonical-evt-001',
    dedup_status: 'miss',
    status: 'delivered',
    retry_count: 0,
    ...overrides,
  };
}

describe('checkNativeIdDerivesFromCanonical', () => {
  it('passes when the native id equals the canonical atlas_event_id', () => {
    const result = checkNativeIdDerivesFromCanonical(baseRow());
    expect(result.violated).toBe(false);
  });

  it('flags when the native id diverges from the canonical id on a dedup miss', () => {
    const result = checkNativeIdDerivesFromCanonical(baseRow({ event_id: 'some-other-uuid' }));
    expect(result.violated).toBe(true);
    expect(result.reason).toContain('does not derive from canonical');
  });

  it('does not flag divergence on a dedup hit (browser-supplied id reuse is correct)', () => {
    const result = checkNativeIdDerivesFromCanonical(
      baseRow({ event_id: 'browser-beacon-id', dedup_status: 'hit' }),
    );
    expect(result.violated).toBe(false);
  });

  it('does not flag a row with no native id at all', () => {
    const result = checkNativeIdDerivesFromCanonical(baseRow({ event_id: null }));
    expect(result.violated).toBe(false);
  });
});

describe('checkRetriesExhaustedUnconfirmed', () => {
  it('passes for a delivered event regardless of retry_count', () => {
    const result = checkRetriesExhaustedUnconfirmed(baseRow({ status: 'delivered', retry_count: 5 }));
    expect(result.violated).toBe(false);
  });

  it('passes for a failed event below the retry threshold', () => {
    const result = checkRetriesExhaustedUnconfirmed(baseRow({ status: 'delivery_failed', retry_count: 1 }));
    expect(result.violated).toBe(false);
  });

  it('flags a delivery_failed event at or above the retry threshold', () => {
    const result = checkRetriesExhaustedUnconfirmed(baseRow({ status: 'delivery_failed', retry_count: 3 }));
    expect(result.violated).toBe(true);
    expect(result.reason).toContain('retries exhausted');
  });

  it('flags a dead_letter event at or above the retry threshold', () => {
    const result = checkRetriesExhaustedUnconfirmed(baseRow({ status: 'dead_letter', retry_count: 4 }));
    expect(result.violated).toBe(true);
  });
});

describe('checkIdentityIntegrity', () => {
  it('passes a clean, delivered row', () => {
    const result = checkIdentityIntegrity(baseRow());
    expect(result.violated).toBe(false);
  });

  it('surfaces the native-id violation before checking retries', () => {
    const result = checkIdentityIntegrity(
      baseRow({ event_id: 'diverged-id', status: 'delivery_failed', retry_count: 3 }),
    );
    expect(result.violated).toBe(true);
    expect(result.reason).toContain('does not derive from canonical');
  });
});
