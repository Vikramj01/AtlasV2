/**
 * googleDeliveryConfirmation.ts — unit tests
 *
 * summarizeDeliveryConfirmation() and mergeDeliveryConfirmationSummaries()
 * are pure functions over the verified DMARetrieveRequestStatusResponse
 * schema — no mocks needed. retrieveGoogleRequestStatus() itself (the fetch
 * wrapper) is exercised indirectly via pipeline/worker integration; these
 * tests focus on the outcome-classification logic, which is where the real
 * behavioural risk lives (worst-status-wins across destinations/batches).
 */

import { describe, it, expect } from 'vitest';
import { summarizeDeliveryConfirmation, mergeDeliveryConfirmationSummaries } from '../googleDeliveryConfirmation';
import type { DMARequestStatusPerDestination } from '@/integrations/google/dmaTypes';

function destination(overrides: Partial<DMARequestStatusPerDestination>): DMARequestStatusPerDestination {
  return {
    requestStatus: 'SUCCESS',
    ...overrides,
  };
}

describe('summarizeDeliveryConfirmation', () => {
  it('returns still_processing when the response has no destinations at all', () => {
    const r = summarizeDeliveryConfirmation({});
    expect(r.outcome).toBe('still_processing');
  });

  it('SUCCESS with no errorCounts → confirmed_success', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [destination({ requestStatus: 'SUCCESS' })],
    });
    expect(r.outcome).toBe('confirmed_success');
    expect(r.reasons).toEqual([]);
  });

  it('SUCCESS but with non-zero errorCounts → confirmed_partial, not a clean success', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [
        destination({
          requestStatus: 'SUCCESS',
          errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: '1' }] },
        }),
      ],
    });
    expect(r.outcome).toBe('confirmed_partial');
    expect(r.reasons).toContain('PROCESSING_ERROR_REASON_INVALID_GCLID');
  });

  it('SUCCESS with a zero-count errorCounts entry stays confirmed_success', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [
        destination({
          requestStatus: 'SUCCESS',
          errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: '0' }] },
        }),
      ],
    });
    expect(r.outcome).toBe('confirmed_success');
  });

  it('FAILED → confirmed_failed', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [destination({ requestStatus: 'FAILED' })],
    });
    expect(r.outcome).toBe('confirmed_failed');
  });

  it('PARTIAL_SUCCESS → confirmed_partial', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [destination({ requestStatus: 'PARTIAL_SUCCESS' })],
    });
    expect(r.outcome).toBe('confirmed_partial');
  });

  it('PROCESSING → still_processing', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [destination({ requestStatus: 'PROCESSING' })],
    });
    expect(r.outcome).toBe('still_processing');
  });

  it('REQUEST_STATUS_UNKNOWN → still_processing (ambiguity is never treated as failure)', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [destination({ requestStatus: 'REQUEST_STATUS_UNKNOWN' })],
    });
    expect(r.outcome).toBe('still_processing');
  });

  it('worst status wins across multiple destinations (Google Ads SUCCESS + GA4 FAILED)', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [
        destination({ requestStatus: 'SUCCESS' }),
        destination({ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INTERNAL_ERROR' }] } }),
      ],
    });
    expect(r.outcome).toBe('confirmed_failed');
    expect(r.reasons).toContain('PROCESSING_ERROR_REASON_INTERNAL_ERROR');
  });

  it('FAILED outranks PARTIAL_SUCCESS which outranks PROCESSING which outranks SUCCESS', () => {
    const r = summarizeDeliveryConfirmation({
      requestStatusPerDestination: [
        destination({ requestStatus: 'SUCCESS' }),
        destination({ requestStatus: 'PROCESSING' }),
        destination({ requestStatus: 'PARTIAL_SUCCESS' }),
      ],
    });
    expect(r.outcome).toBe('confirmed_partial');
  });
});

describe('mergeDeliveryConfirmationSummaries', () => {
  it('returns still_processing for an empty list', () => {
    expect(mergeDeliveryConfirmationSummaries([]).outcome).toBe('still_processing');
  });

  it('worst outcome wins across batches, reasons deduplicated', () => {
    const merged = mergeDeliveryConfirmationSummaries([
      { outcome: 'confirmed_success', reasons: [] },
      { outcome: 'confirmed_failed', reasons: ['PROCESSING_ERROR_REASON_INVALID_GCLID'] },
      { outcome: 'confirmed_partial', reasons: ['PROCESSING_ERROR_REASON_INVALID_GCLID', 'PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID'] },
    ]);
    expect(merged.outcome).toBe('confirmed_failed');
    expect(merged.reasons.sort()).toEqual(
      ['PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID', 'PROCESSING_ERROR_REASON_INVALID_GCLID'].sort(),
    );
  });

  it('all confirmed_success → confirmed_success', () => {
    const merged = mergeDeliveryConfirmationSummaries([
      { outcome: 'confirmed_success', reasons: [] },
      { outcome: 'confirmed_success', reasons: [] },
    ]);
    expect(merged.outcome).toBe('confirmed_success');
  });
});
