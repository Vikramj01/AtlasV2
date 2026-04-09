import type Stripe from 'stripe';
import { getStripe } from './client';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import logger from '@/utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingPlan = 'free' | 'pro' | 'agency';

export type SubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled';

export interface BillingStatus {
  plan: BillingPlan;
  subscription_status: SubscriptionStatus;
  current_period_end: string | null;
  stripe_customer_id: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Return the configured price ID for the given plan, or throw if unconfigured. */
function priceIdForPlan(plan: 'pro' | 'agency'): string {
  const id = plan === 'pro' ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_AGENCY;
  if (!id) {
    throw new Error(
      `STRIPE_PRICE_${plan.toUpperCase()} is not configured. ` +
      'Add it to your environment variables.',
    );
  }
  return id;
}

/** Derive the Atlas plan tier from a Stripe price ID. Returns 'free' if unknown. */
function planFromPriceId(priceId: string): BillingPlan {
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (env.STRIPE_PRICE_AGENCY && priceId === env.STRIPE_PRICE_AGENCY) return 'agency';
  return 'free';
}

/** Map a Stripe subscription status to the Atlas subscription_status value. */
function mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':    return 'active';
    case 'trialing':  return 'trialing';
    case 'past_due':  return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'inactive';
  }
}

/** Get the Stripe customer ID stored on the user's profile (may be null). */
async function getStoredCustomerId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();
  return (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
}

/** Persist the Stripe customer ID on the user's profile. */
async function saveCustomerId(userId: string, customerId: string): Promise<void> {
  await supabaseAdmin
    .from('profiles')
    .update({ stripe_customer_id: customerId })
    .eq('id', userId);
}

/**
 * Get or create a Stripe Customer for the user.
 * Idempotent — reuses the stored customer ID on repeat calls.
 */
async function ensureStripeCustomer(userId: string, email: string): Promise<string> {
  const existing = await getStoredCustomerId(userId);
  if (existing) return existing;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  await saveCustomerId(userId, customer.id);
  logger.info({ userId, customerId: customer.id }, 'Stripe: created new customer');
  return customer.id;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session in subscription mode.
 * Returns the hosted checkout URL to redirect the user to.
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  plan: 'pro' | 'agency',
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(userId, email);
  const priceId = priceIdForPlan(plan);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Carry plan + userId through to the webhook so we can update the right row
    metadata: { userId, plan },
    subscription_data: {
      metadata: { userId, plan },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  logger.info({ userId, plan, sessionId: session.id }, 'Stripe: checkout session created');
  return session.url;
}

/**
 * Create a Stripe Billing Portal session.
 * Allows the customer to manage their subscription, update payment, or cancel.
 * Returns the portal URL to redirect the user to.
 */
export async function createPortalSession(
  userId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const customerId = await getStoredCustomerId(userId);

  if (!customerId) {
    throw new Error('No Stripe customer found for this user. Subscribe first.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  logger.info({ userId, customerId }, 'Stripe: portal session created');
  return session.url;
}

/**
 * Sync a Stripe Subscription object to the Atlas profiles table.
 * Called from webhook handlers for subscription.updated / subscription.deleted /
 * checkout.session.completed.
 *
 * Looks up the profile by stripe_customer_id; if not found falls back to
 * subscription.metadata.userId.
 */
export async function syncSubscriptionToProfile(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const plan = planFromPriceId(priceId);
  const status = mapSubscriptionStatus(subscription.status);
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

  // Active/trialing → grant the paid plan; anything else → downgrade to free
  const effectivePlan: BillingPlan =
    status === 'active' || status === 'trialing' ? plan : 'free';

  const updatePayload = {
    stripe_subscription_id: subscription.id,
    subscription_status: status,
    current_period_end: periodEnd,
    plan: effectivePlan,
  };

  // Primary lookup: by customer ID (most reliable)
  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updatePayload)
    .eq('stripe_customer_id', customerId);

  if (error) {
    logger.error(
      { customerId, subscriptionId: subscription.id, error },
      'Stripe: failed to sync subscription to profile',
    );
    throw new Error(`Sync failed: ${error.message}`);
  }

  logger.info(
    { customerId, subscriptionId: subscription.id, status, plan: effectivePlan },
    'Stripe: subscription synced to profile',
  );
}

/**
 * Mark a profile as past_due when an invoice payment fails.
 * Does not downgrade the plan — gives the user a grace period to update payment.
 */
export async function markProfilePastDue(subscriptionId: string): Promise<void> {
  await supabaseAdmin
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_subscription_id', subscriptionId);

  logger.warn({ subscriptionId }, 'Stripe: profile marked past_due after payment failure');
}

/**
 * Fetch the current billing status for a user from the profiles table.
 */
export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('plan, subscription_status, current_period_end, stripe_customer_id')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('Failed to fetch billing status');
  }

  const row = data as {
    plan: BillingPlan;
    subscription_status: SubscriptionStatus;
    current_period_end: string | null;
    stripe_customer_id: string | null;
  };

  return {
    plan: row.plan ?? 'free',
    subscription_status: row.subscription_status ?? 'inactive',
    current_period_end: row.current_period_end ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null,
  };
}
