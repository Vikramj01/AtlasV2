import { create } from 'zustand';
import { billingApi } from '@/lib/api/billingApi';
import type { BillingStatus } from '@/lib/api/billingApi';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface BillingStore {
  status: BillingStatus | null;
  loadState: LoadState;
  checkoutLoading: boolean;
  portalLoading: boolean;
  error: string | null;

  /** Fetch current billing status from the backend. */
  fetchStatus: () => Promise<void>;

  /**
   * Redirect to Stripe Checkout for the given plan.
   * Uses window.location.href so the full page navigates to Stripe.
   */
  startCheckout: (plan: 'pro' | 'agency') => Promise<void>;

  /**
   * Redirect to the Stripe Billing Portal so the user can manage
   * their subscription, update payment details, or cancel.
   */
  openPortal: () => Promise<void>;
}

export const useBillingStore = create<BillingStore>((set) => ({
  status: null,
  loadState: 'idle',
  checkoutLoading: false,
  portalLoading: false,
  error: null,

  fetchStatus: async () => {
    set({ loadState: 'loading', error: null });
    try {
      const status = await billingApi.getStatus();
      set({ status, loadState: 'loaded' });
    } catch (err) {
      set({
        loadState: 'error',
        error: err instanceof Error ? err.message : 'Failed to load billing status',
      });
    }
  },

  startCheckout: async (plan) => {
    set({ checkoutLoading: true, error: null });
    try {
      const url = await billingApi.createCheckout(plan);
      window.location.href = url;
    } catch (err) {
      set({
        checkoutLoading: false,
        error: err instanceof Error ? err.message : 'Failed to start checkout',
      });
    }
  },

  openPortal: async () => {
    set({ portalLoading: true, error: null });
    try {
      const url = await billingApi.openPortal();
      window.location.href = url;
    } catch (err) {
      set({
        portalLoading: false,
        error: err instanceof Error ? err.message : 'Failed to open billing portal',
      });
    }
  },
}));
