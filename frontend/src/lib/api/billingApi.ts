import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type BillingPlan = 'free' | 'pro' | 'agency';
export type SubscriptionStatus = 'inactive' | 'active' | 'trialing' | 'past_due' | 'canceled';

export interface BillingStatus {
  plan: BillingPlan;
  subscription_status: SubscriptionStatus;
  current_period_end: string | null;
  stripe_customer_id: string | null;
}

export const billingApi = {
  /** Fetch current plan + subscription status. */
  getStatus: () =>
    apiFetch<{ data: BillingStatus }>('/api/billing/status').then((r) => r.data),

  /**
   * Create a Stripe Checkout Session for the given plan.
   * Returns the Stripe-hosted checkout URL — redirect the user there.
   */
  createCheckout: (plan: 'pro' | 'agency') =>
    apiFetch<{ data: { url: string } }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }).then((r) => r.data.url),

  /**
   * Create a Stripe Billing Portal session.
   * Returns the portal URL — redirect the user there to manage their subscription.
   */
  openPortal: () =>
    apiFetch<{ data: { url: string } }>('/api/billing/portal', {
      method: 'POST',
    }).then((r) => r.data.url),
};
