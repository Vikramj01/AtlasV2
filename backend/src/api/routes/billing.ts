/**
 * Billing routes — /api/billing
 *
 * POST /checkout  → create a Stripe Checkout Session (auth required)
 * POST /portal    → create a Stripe Billing Portal session (auth required)
 * GET  /status    → current plan + subscription status (auth required)
 * POST /webhook   → Stripe webhook endpoint (NO auth, raw body, signature-verified)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type Stripe from 'stripe';
import { getStripe } from '@/services/stripe/client';
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  syncSubscriptionToProfile,
  markProfilePastDue,
} from '@/services/stripe/subscriptionService';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const router = Router();

// ─── Checkout ─────────────────────────────────────────────────────────────────

const CheckoutBody = z.object({
  plan: z.enum(['pro', 'agency']),
});

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout Session and returns the redirect URL.
 */
router.post('/checkout', authMiddleware, async (req: Request, res: Response) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });
    return;
  }

  try {
    const { plan } = parsed.data;
    const baseUrl = env.FRONTEND_URL;

    const url = await createCheckoutSession(
      req.user.id,
      req.user.email,
      plan,
      `${baseUrl}/settings/billing/success`,
      `${baseUrl}/settings/billing/cancel`,
    );

    res.json({ data: { url } });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'Billing: checkout session failed');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ─── Portal ───────────────────────────────────────────────────────────────────

/**
 * POST /api/billing/portal
 * Creates a Stripe Billing Portal session for plan/payment management.
 */
router.post('/portal', authMiddleware, async (req: Request, res: Response) => {
  try {
    const url = await createPortalSession(
      req.user.id,
      `${env.FRONTEND_URL}/settings`,
    );
    res.json({ data: { url } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Surface the "no customer" case as a 400 rather than 500
    if (message.includes('No Stripe customer')) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error({ err, userId: req.user.id }, 'Billing: portal session failed');
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * GET /api/billing/status
 * Returns the user's current plan, subscription status, and period end.
 */
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await getBillingStatus(req.user.id);
    res.json({ data: status });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'Billing: status fetch failed');
    res.status(500).json({ error: 'Failed to fetch billing status' });
  }
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * POST /api/billing/webhook
 *
 * Stripe sends events here. The route must receive the raw body (Buffer) —
 * express.raw() is applied for this path BEFORE express.json() in app.ts.
 *
 * Events handled:
 *   checkout.session.completed       → first subscription confirmed
 *   customer.subscription.updated    → plan change / renewal
 *   customer.subscription.deleted    → cancellation
 *   invoice.payment_failed           → mark as past_due
 */
router.post('/webhook', async (req: Request, res: Response) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    logger.warn('Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured');
    res.status(400).json({ error: 'Webhook secret not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body as Buffer,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    logger.warn({ err: message }, 'Stripe: webhook signature verification failed');
    res.status(400).json({ error: `Webhook error: ${message}` });
    return;
  }

  logger.info({ type: event.type, id: event.id }, 'Stripe: webhook received');

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subscription = await getStripe().subscriptions.retrieve(
            session.subscription as string,
          );
          await syncSubscriptionToProfile(subscription);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionToProfile(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id ?? null;
        if (subId) {
          await markProfilePastDue(subId);
        }
        break;
      }

      default:
        // Acknowledge unhandled events — Stripe will not retry them
        logger.debug({ type: event.type }, 'Stripe: unhandled webhook event type');
    }
  } catch (err) {
    logger.error({ err, eventType: event.type, eventId: event.id }, 'Stripe: webhook handler error');
    // Return 500 so Stripe retries the event
    res.status(500).json({ error: 'Webhook handler failed' });
    return;
  }

  // Always acknowledge quickly — Stripe requires a 2xx within 30s
  res.json({ received: true });
});

export { router as billingRouter };
