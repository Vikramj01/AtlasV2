/**
 * Shopify App routes — /api/shopify
 *
 * Public — no authMiddleware. This is the entire surface a merchant's
 * browser and Shopify's own servers touch before any Atlas login exists:
 *
 *   GET  /install                    — merchant clicks "Add app", redirects to Shopify's OAuth authorize
 *   GET  /callback                   — Shopify redirects back here after approval; provisions the org
 *   POST /webhooks/orders-paid       — order webhook (HMAC-verified)
 *   POST /webhooks/refunds-create    — refund webhook (HMAC-verified)
 *   POST /webhooks/app-uninstalled   — marks the connection revoked (HMAC-verified)
 *   POST /webhooks/customers-data-request  — mandatory GDPR webhook (HMAC-verified)
 *   POST /webhooks/customers-redact        — mandatory GDPR webhook (HMAC-verified)
 *   POST /webhooks/shop-redact             — mandatory GDPR webhook (HMAC-verified)
 *
 * The webhook routes require express.raw() ahead of express.json() for
 * these exact paths — wired in app.ts, same ordering requirement as the
 * Stripe webhook.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  isValidShopDomain,
  generateState,
  verifyState,
  verifyCallbackHmac,
  getAuthUrl,
  exchangeCodeForToken,
} from '@/services/connections/oauthFlows/shopifyOAuth';
import { verifyWebhookHmac } from '@/services/connections/shopify/shopifyWebhookVerify';
import { SHOPIFY_CAPTURE_SCRIPT } from '@/services/connections/shopify/shopifyCaptureScript';
import { provisionShopifyInstall } from '@/services/connections/shopify/shopifyProvisioning';
import { enqueueShopifyOrderEvent, enqueueShopifyRefundEvent } from '@/services/capi/shopifyWebhookIngest';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export const shopifyAppRouter = Router();

// ── GET /api/shopify/capture.js ─────────────────────────────────────────────
// Served content for the ScriptTag registered by registerScriptTag() at
// install time (shopifyProvisioning.ts). Public, static, cacheable — no
// per-shop templating needed, the script reads everything it needs from
// the page it's running on.

shopifyAppRouter.get('/capture.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(SHOPIFY_CAPTURE_SCRIPT);
});

// ── GET /api/shopify/install ───────────────────────────────────────────────────

shopifyAppRouter.get('/install', (req: Request, res: Response) => {
  const shop = req.query.shop;
  if (typeof shop !== 'string' || !isValidShopDomain(shop)) {
    res.status(400).json({ error: 'A valid shop query parameter (*.myshopify.com) is required' });
    return;
  }

  const state = generateState(shop);
  res.redirect(getAuthUrl(shop, state));
});

// ── GET /api/shopify/callback ───────────────────────────────────────────────────

shopifyAppRouter.get('/callback', async (req: Request, res: Response) => {
  const { shop, code, state } = req.query;

  if (typeof shop !== 'string' || !isValidShopDomain(shop)) {
    res.status(400).json({ error: 'Invalid shop parameter' });
    return;
  }
  if (typeof code !== 'string' || !code) {
    res.status(400).json({ error: 'Missing code parameter' });
    return;
  }
  if (typeof state !== 'string' || !state) {
    res.status(400).json({ error: 'Missing state parameter' });
    return;
  }

  const queryAsStrings: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') queryAsStrings[key] = value;
  }

  if (!verifyCallbackHmac(queryAsStrings)) {
    logger.warn({ shop }, 'Shopify callback: HMAC verification failed');
    res.status(401).json({ error: 'HMAC verification failed' });
    return;
  }

  try {
    verifyState(state, shop);
  } catch (err) {
    logger.warn({ shop, err }, 'Shopify callback: state verification failed');
    res.status(401).json({ error: err instanceof Error ? err.message : 'State verification failed' });
    return;
  }

  try {
    const { access_token, scope } = await exchangeCodeForToken(shop, code);
    const result = await provisionShopifyInstall(shop, access_token, scope);

    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/shopify/welcome?shop=${encodeURIComponent(shop)}&new=${result.isNewInstall}`);
  } catch (err) {
    logger.error({ shop, err }, 'Shopify callback: provisioning failed');
    res.status(500).json({ error: 'Failed to complete installation. Please try again or contact support.' });
  }
});

// ── Webhook helpers ──────────────────────────────────────────────────────────

async function verifyAndParseWebhook(req: Request, res: Response): Promise<{ shop: string; payload: unknown } | null> {
  const rawBody = req.body as Buffer;
  const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string | undefined;

  if (!Buffer.isBuffer(rawBody) || !verifyWebhookHmac(rawBody, hmacHeader)) {
    logger.warn({ path: req.path }, 'Shopify webhook: HMAC verification failed');
    res.status(401).json({ error: 'HMAC verification failed' });
    return null;
  }

  const shop = req.headers['x-shopify-shop-domain'] as string | undefined;
  if (!shop) {
    res.status(400).json({ error: 'Missing X-Shopify-Shop-Domain header' });
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return null;
  }

  return { shop, payload };
}

// ── POST /api/shopify/webhooks/orders-paid ────────────────────────────────────

shopifyAppRouter.post('/webhooks/orders-paid', async (req: Request, res: Response) => {
  const verified = await verifyAndParseWebhook(req, res);
  if (!verified) return;

  try {
    await enqueueShopifyOrderEvent(verified.shop, verified.payload);
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err, shop: verified.shop }, 'Shopify orders/paid webhook: failed to enqueue');
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// ── POST /api/shopify/webhooks/refunds-create ─────────────────────────────────

shopifyAppRouter.post('/webhooks/refunds-create', async (req: Request, res: Response) => {
  const verified = await verifyAndParseWebhook(req, res);
  if (!verified) return;

  try {
    await enqueueShopifyRefundEvent(verified.shop, verified.payload);
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err, shop: verified.shop }, 'Shopify refunds/create webhook: failed to enqueue');
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// ── POST /api/shopify/webhooks/app-uninstalled ────────────────────────────────

shopifyAppRouter.post('/webhooks/app-uninstalled', async (req: Request, res: Response) => {
  const verified = await verifyAndParseWebhook(req, res);
  if (!verified) return;

  const { error } = await supabaseAdmin
    .from('platform_connections')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('platform', 'shopify')
    .eq('account_id', verified.shop);

  if (error) logger.error({ error, shop: verified.shop }, 'Shopify app/uninstalled: failed to revoke connection');

  res.status(200).json({ received: true });
});

// ── Mandatory GDPR compliance webhooks ─────────────────────────────────────────
// v1 acknowledges + logs for manual follow-up within Shopify's 30-day window
// rather than automated cross-table erasure — see the plan's explicit scope note.

async function logComplianceRequest(
  topic: 'customers_data_request' | 'customers_redact' | 'shop_redact',
  req: Request,
  res: Response,
): Promise<void> {
  const verified = await verifyAndParseWebhook(req, res);
  if (!verified) return;

  const { error } = await supabaseAdmin.from('shopify_compliance_requests').insert({
    shop_domain: verified.shop,
    topic,
    payload: verified.payload,
  });

  if (error) logger.error({ error, shop: verified.shop, topic }, 'Shopify compliance webhook: failed to log request');

  res.status(200).json({ received: true });
}

shopifyAppRouter.post('/webhooks/customers-data-request', (req, res) => logComplianceRequest('customers_data_request', req, res));
shopifyAppRouter.post('/webhooks/customers-redact', (req, res) => logComplianceRequest('customers_redact', req, res));
shopifyAppRouter.post('/webhooks/shop-redact', (req, res) => logComplianceRequest('shop_redact', req, res));
