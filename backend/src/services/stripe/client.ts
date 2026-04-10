import Stripe from 'stripe';
import { env } from '@/config/env';

/**
 * Stripe singleton — initialised lazily so the server can still boot when
 * STRIPE_SECRET_KEY is not set (e.g. local dev without billing).
 * Calling getStripe() when the key is absent throws a clear error.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured. ' +
      'Add it to your environment variables to enable billing.',
    );
  }

  // Cast allows the Stripe client to work with the account's active API version
  // regardless of which stripe npm version is installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-04-30.basil' as any,
  });

  return _stripe;
}
