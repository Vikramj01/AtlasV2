/**
 * refundDelivery.ts — submitGoogleConversionAdjustment tests
 *
 * Covers: skip cases (no creds, no conversion_action_id, missing partial
 * refund value), success (RESTATEMENT/RETRACTION), 401-then-retry success,
 * partialFailureError handling, and non-ok HTTP responses — all without
 * ever throwing (fire-and-forget contract).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../credentials', () => ({
  safeDecryptCredentials: vi.fn(),
}));

vi.mock('../customerMatch', () => ({
  ingestCustomerMatchBatch: vi.fn(),
}));

vi.mock('../googleDelivery', () => ({
  refreshGoogleToken: vi.fn(),
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from '../credentials';
import { refreshGoogleToken } from '../googleDelivery';
import { submitGoogleConversionAdjustment } from '../refundDelivery';
import type { RefundEvent } from '@/types/refunds';

function makeChain(singleData: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  // update(...).eq(...) is awaited directly in updateGoogleAdjustmentStatus
  chain.then = (resolve: Function) => resolve({ data: null, error: null });
  return chain as any;
}

function makeRefund(overrides: Partial<RefundEvent> = {}): RefundEvent {
  return {
    id: 'refund-1',
    organization_id: 'org-1',
    client_id: null,
    original_transaction_id: 'order-123',
    refund_amount: 20,
    currency: 'USD',
    is_partial: false,
    new_conversion_value: null,
    reason: null,
    hashed_email: null,
    hashed_phone: null,
    google_removal_status: 'pending',
    google_removal_error: null,
    adjustment_csv_generated_at: null,
    google_adjustment_status: 'pending',
    google_adjustment_error: null,
    google_adjustment_submitted_at: null,
    meta_status: 'logged',
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('submitGoogleConversionAdjustment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips a partial refund with no recorded new_conversion_value', async () => {
    const chain = makeChain();
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund({ is_partial: true, new_conversion_value: null }));

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ google_adjustment_status: 'skipped' }));
  });

  it('skips when there is no active Google connection', async () => {
    const chain = makeChain(null); // getActiveGoogleCredentials -> maybeSingle() -> null
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund());

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ google_adjustment_status: 'skipped', google_adjustment_error: expect.stringContaining('No active Google connection') }),
    );
  });

  it('skips when the connection has no conversion_action_id/customer_id', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '',
    } as any);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund());

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ google_adjustment_status: 'skipped', google_adjustment_error: expect.stringContaining('conversion_action_id') }),
    );
  });

  it('submits a RETRACTION for a full refund and marks it submitted', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '123-456-7890', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund({ is_partial: false }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(':uploadConversionAdjustments');
    expect(url).toContain('customers/1234567890');
    const body = JSON.parse(init.body as string);
    expect(body.conversionAdjustments[0]).toMatchObject({
      conversionAction: 'customers/1234567890/conversionActions/999',
      orderId: 'order-123',
      adjustmentType: 'RETRACTION',
    });
    expect(body.conversionAdjustments[0].restatementValue).toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ google_adjustment_status: 'submitted' }));
  });

  it('submits a RESTATEMENT with the corrected value for a partial refund', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '1234567890', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund({
      is_partial: true, new_conversion_value: 42.5, currency: 'GBP',
    }));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.conversionAdjustments[0]).toMatchObject({
      adjustmentType: 'RESTATEMENT',
      restatementValue: { adjustedValue: 42.5, currencyCode: 'GBP' },
    });
  });

  it('retries once on 401 via refreshGoogleToken and succeeds', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '1234567890', oauth_access_token: 'stale-at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    vi.mocked(refreshGoogleToken).mockResolvedValue('fresh-at');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund());

    expect(refreshGoogleToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ google_adjustment_status: 'submitted' }));
  });

  it('marks failed on a non-ok, non-401 response', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '1234567890', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { message: 'INVALID_ARGUMENT' } }),
    }));

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund());

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ google_adjustment_status: 'failed', google_adjustment_error: 'INVALID_ARGUMENT' }),
    );
  });

  it('marks failed when the response carries a partialFailureError', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '1234567890', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ partialFailureError: { message: 'Order ID not found' } }),
    }));

    await submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund());

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ google_adjustment_status: 'failed', google_adjustment_error: 'Order ID not found' }),
    );
  });

  it('never throws even when fetch itself rejects', async () => {
    const chain = makeChain({ credentials: 'blob' });
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain);
    vi.mocked(safeDecryptCredentials).mockReturnValue({
      customer_id: '1234567890', oauth_access_token: 'at', oauth_refresh_token: 'rt', conversion_action_id: '999',
    } as any);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(submitGoogleConversionAdjustment('org-1', 'refund-1', makeRefund())).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ google_adjustment_status: 'failed', google_adjustment_error: 'network down' }),
    );
  });
});
