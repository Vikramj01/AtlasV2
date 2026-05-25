/**
 * billingStore tests — Stripe billing Zustand state
 *
 * Tests: fetchStatus (success sets status + loadState='loaded',
 *        failure sets error + loadState='error'),
 *        startCheckout (calls API, navigates to checkout URL),
 *        openPortal (calls API, navigates to portal URL).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/billingApi', () => ({
  billingApi: {
    getStatus: vi.fn(),
    createCheckout: vi.fn(),
    openPortal: vi.fn(),
  },
}));

import { useBillingStore } from '@/store/billingStore';
import { billingApi } from '@/lib/api/billingApi';

const BILLING_STATUS = {
  plan: 'pro' as const,
  subscription_status: 'active' as const,
  current_period_end: '2026-12-31T00:00:00Z',
  stripe_customer_id: 'cus_test123',
  isSuperAdmin: false,
};

describe('billingStore', () => {
  beforeEach(() => {
    // Reset to idle state between tests
    useBillingStore.setState({
      status: null,
      loadState: 'idle',
      checkoutLoading: false,
      portalLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  // ── fetchStatus ───────────────────────────────────────────────────────────────

  describe('fetchStatus', () => {
    it('sets status and loadState=loaded on success', async () => {
      vi.mocked(billingApi.getStatus).mockResolvedValue(BILLING_STATUS);
      await useBillingStore.getState().fetchStatus();
      expect(useBillingStore.getState().status).toEqual(BILLING_STATUS);
      expect(useBillingStore.getState().loadState).toBe('loaded');
      expect(useBillingStore.getState().error).toBeNull();
    });

    it('sets error and loadState=error on failure', async () => {
      vi.mocked(billingApi.getStatus).mockRejectedValue(new Error('Unauthorized'));
      await useBillingStore.getState().fetchStatus();
      expect(useBillingStore.getState().status).toBeNull();
      expect(useBillingStore.getState().loadState).toBe('error');
      expect(useBillingStore.getState().error).toBe('Unauthorized');
    });

    it('sets loadState=loading during fetch', async () => {
      let resolve!: (v: any) => void;
      vi.mocked(billingApi.getStatus).mockReturnValue(new Promise((r) => { resolve = r; }));
      const p = useBillingStore.getState().fetchStatus();
      expect(useBillingStore.getState().loadState).toBe('loading');
      resolve(BILLING_STATUS);
      await p;
      expect(useBillingStore.getState().loadState).toBe('loaded');
    });
  });

  // ── startCheckout ─────────────────────────────────────────────────────────────

  describe('startCheckout', () => {
    it('calls billingApi.createCheckout with the correct plan', async () => {
      vi.mocked(billingApi.createCheckout).mockResolvedValue('https://checkout.stripe.com/pay/test');
      // We cannot assert window.location.href reliably in happy-dom,
      // but we can verify the API was called correctly.
      try {
        await useBillingStore.getState().startCheckout('pro');
      } catch {
        // navigation may throw in test env
      }
      expect(billingApi.createCheckout).toHaveBeenCalledWith('pro');
    });

    it('sets error and clears checkoutLoading on failure', async () => {
      vi.mocked(billingApi.createCheckout).mockRejectedValue(new Error('Stripe error'));
      await useBillingStore.getState().startCheckout('agency');
      expect(useBillingStore.getState().checkoutLoading).toBe(false);
      expect(useBillingStore.getState().error).toBe('Stripe error');
    });
  });

  // ── openPortal ────────────────────────────────────────────────────────────────

  describe('openPortal', () => {
    it('calls billingApi.openPortal', async () => {
      vi.mocked(billingApi.openPortal).mockResolvedValue('https://billing.stripe.com/test');
      try {
        await useBillingStore.getState().openPortal();
      } catch {
        // navigation may throw in test env
      }
      expect(billingApi.openPortal).toHaveBeenCalledOnce();
    });

    it('sets error and clears portalLoading on failure', async () => {
      vi.mocked(billingApi.openPortal).mockRejectedValue(new Error('Portal error'));
      await useBillingStore.getState().openPortal();
      expect(useBillingStore.getState().portalLoading).toBe(false);
      expect(useBillingStore.getState().error).toBe('Portal error');
    });
  });
});
