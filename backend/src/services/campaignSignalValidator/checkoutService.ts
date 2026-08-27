/**
 * Campaign Signal Validator — Standalone Checkout
 *
 * A one-time Stripe Checkout Session (mode: 'payment'), distinct from
 * subscriptionService.ts's recurring pro/agency subscriptions — nothing like
 * a one-time purchase existed elsewhere in Atlas's billing before this (B9).
 *
 * Uses inline price_data rather than a dashboard-configured Price ID so this
 * doesn't require extra Stripe dashboard setup to deploy — the amount is
 * controlled by SIGNAL_VALIDATOR_PRICE_CENTS.
 */

import { getStripe } from '@/services/stripe/client';
import { supabaseAdmin, uploadSignalValidatorPdf } from '@/services/database/supabase';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export interface SignalValidatorCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
}

export async function createSignalValidatorCheckout(
  url: string,
  email: string,
  successUrl: string,
  cancelUrl: string,
): Promise<SignalValidatorCheckoutResult> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: env.SIGNAL_VALIDATOR_PRICE_CENTS,
          product_data: {
            name: 'Atlas Campaign Signal Validator',
            description: `Pre-flight conversion signal diagnostic for ${url}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { product: 'campaign_signal_validator', url, email },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');

  const { error } = await supabaseAdmin.from('signal_validator_purchases').insert({
    checkout_session_id: session.id,
    email,
    url,
    amount_cents: env.SIGNAL_VALIDATOR_PRICE_CENTS,
    status: 'pending',
  });

  if (error) {
    logger.error({ err: error.message, sessionId: session.id }, '[signalValidator] Failed to record purchase row');
    throw new Error('Failed to record purchase');
  }

  logger.info({ sessionId: session.id, url }, '[signalValidator] Standalone checkout session created');
  return { checkoutUrl: session.url, sessionId: session.id };
}

/**
 * Called from the Stripe webhook on checkout.session.completed for a
 * campaign_signal_validator purchase. Marks the purchase paid and kicks off
 * the diagnostic run against the URL captured at checkout time.
 */
export async function fulfilSignalValidatorPurchase(checkoutSessionId: string): Promise<void> {
  const { data: purchase, error } = await supabaseAdmin
    .from('signal_validator_purchases')
    .select('id, url, status')
    .eq('checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (error || !purchase) {
    logger.error({ err: error?.message, checkoutSessionId }, '[signalValidator] Purchase not found for session');
    return;
  }

  const row = purchase as { id: string; url: string; status: string };
  if (row.status === 'paid') return; // already fulfilled — webhook retries are expected

  // Import lazily to avoid a circular import (orchestrator doesn't depend on checkout).
  const { runDiagnostic } = await import('./orchestrator');
  const run = await runDiagnostic({ url: row.url, source: 'standalone' });

  // Best-effort: the paid product's value is the diagnostic result, which is
  // already persisted on the run row regardless of PDF generation succeeding.
  const verdict = run.verdict;
  if (run.status === 'completed' && verdict) {
    try {
      const { generateSignalValidatorPdf } = await import('./pdfGenerator');
      const pdfBuffer = await generateSignalValidatorPdf({
        url: row.url,
        verdict,
        generatedAt: new Date(),
      });
      const path = await uploadSignalValidatorPdf(run.id, pdfBuffer);
      await supabaseAdmin.from('signal_validator_runs').update({ pdf_storage_path: path }).eq('id', run.id);
    } catch (err) {
      logger.error({ err, runId: run.id }, '[signalValidator] PDF generation/upload failed');
    }
  }

  await supabaseAdmin
    .from('signal_validator_purchases')
    .update({ status: 'paid', paid_at: new Date().toISOString(), run_id: run.id })
    .eq('id', row.id);

  logger.info({ checkoutSessionId, runId: run.id }, '[signalValidator] Purchase fulfilled, diagnostic run created');
}
