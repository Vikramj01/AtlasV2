import { env } from '@/config/env';
import logger from '@/utils/logger';
import type { ShopifyOrderPayload } from '@/services/capi/shopifyOrderMapper';

// Thin wrapper around the Shopify Admin REST API. Every call is
// per-shop-domain + per-access-token — there is no "manager" concept for
// Shopify the way Google Ads/Meta have one, each installed shop is its own
// standalone connection.

export interface ShopifyShopInfo {
  id: number;
  name: string;
  email: string;
  domain: string;
  myshopify_domain: string;
  currency: string;
}

function adminUrl(shop: string, path: string): string {
  return `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/${path}`;
}

async function shopifyFetch(shop: string, accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(adminUrl(shop, path), {
    ...init,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return response;
}

export async function getShopInfo(shop: string, accessToken: string): Promise<ShopifyShopInfo> {
  const response = await shopifyFetch(shop, accessToken, 'shop.json');
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify getShopInfo failed (${response.status}): ${body}`);
  }
  const json = await response.json() as { shop: ShopifyShopInfo };
  return json.shop;
}

// Refund webhooks carry neither the original order's total (needed for
// is_partial / new_conversion_value) nor customer identity (needed for the
// Google audience-removal call) — so refund processing fetches the live
// order first. Reuses ShopifyOrderPayload since it's the same Order resource.
export async function getOrder(shop: string, accessToken: string, orderId: string | number): Promise<ShopifyOrderPayload> {
  const response = await shopifyFetch(shop, accessToken, `orders/${orderId}.json`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify getOrder(${orderId}) failed (${response.status}): ${body}`);
  }
  const json = await response.json() as { order: ShopifyOrderPayload };
  return json.order;
}

// Registers a single webhook topic against this app's endpoint for a shop.
// Called once per topic during install (see shopifyProvisioning.ts).
// If Atlas later migrates to Shopify-CLI-managed app config (declarative
// webhook subscriptions in the app's TOML), the three mandatory GDPR topics
// would move there instead of being registered per-shop via this call —
// noted as an open question for whichever team registers the app in
// Shopify's Partner Dashboard, not a blocker for this REST-based approach.
export async function registerWebhook(shop: string, accessToken: string, topic: string, address: string): Promise<{ id: number }> {
  const response = await shopifyFetch(shop, accessToken, 'webhooks.json', {
    method: 'POST',
    body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify registerWebhook(${topic}) failed (${response.status}): ${body}`);
  }

  const json = await response.json() as { webhook: { id: number } };
  return { id: json.webhook.id };
}

// Auto-injects a script onto every storefront page via Shopify's ScriptTag
// API — no merchant theme editing required, works on every Shopify plan
// (this is a storefront-level mechanism, not checkout customization, so it
// doesn't need Shopify Plus / checkout extensibility). Used to install the
// click-ID capture script (see shopifyCaptureScript.ts).
export async function registerScriptTag(shop: string, accessToken: string, src: string): Promise<{ id: number }> {
  const response = await shopifyFetch(shop, accessToken, 'script_tags.json', {
    method: 'POST',
    body: JSON.stringify({ script_tag: { event: 'onload', src, display_scope: 'online_store' } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify registerScriptTag failed (${response.status}): ${body}`);
  }

  const json = await response.json() as { script_tag: { id: number } };
  return { id: json.script_tag.id };
}

export async function registerAllWebhooks(shop: string, accessToken: string, backendBaseUrl: string): Promise<Record<string, number>> {
  const topics: Array<[string, string]> = [
    ['orders/paid', `${backendBaseUrl}/api/shopify/webhooks/orders-paid`],
    ['refunds/create', `${backendBaseUrl}/api/shopify/webhooks/refunds-create`],
    ['app/uninstalled', `${backendBaseUrl}/api/shopify/webhooks/app-uninstalled`],
    ['customers/data_request', `${backendBaseUrl}/api/shopify/webhooks/customers-data-request`],
    ['customers/redact', `${backendBaseUrl}/api/shopify/webhooks/customers-redact`],
    ['shop/redact', `${backendBaseUrl}/api/shopify/webhooks/shop-redact`],
  ];

  const ids: Record<string, number> = {};
  for (const [topic, address] of topics) {
    try {
      const { id } = await registerWebhook(shop, accessToken, topic, address);
      ids[topic] = id;
    } catch (err) {
      // Don't let one failed registration abort the whole install — log and
      // continue, the missing subscription is visible in the persisted
      // metadata.webhook_ids for follow-up rather than silently retried.
      logger.error({ err, shop, topic }, 'Shopify: webhook registration failed');
    }
  }
  return ids;
}
