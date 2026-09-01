import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { env } from '@/config/env';

// Shopify OAuth is per-shop-domain (the authorize URL is host-specific), so
// this module's state carries the shop domain instead of a client id — the
// mirror of googleAdsOAuth.ts's clientId-in-state pattern, but there is no
// authenticated Atlas user/client at install time, only the shop.

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test(shop);
}

// HMAC-SHA256 state parameter for CSRF protection.
// state = nonce:shop:timestamp:hmac
export function generateState(shop: string): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const payload = `${nonce}:${shop}:${ts}`;
  const hmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

export function verifyState(state: string, expectedShop: string): void {
  const decoded = Buffer.from(state, 'base64url').toString('utf8');
  const parts = decoded.split(':');
  if (parts.length !== 4) throw new Error('Invalid OAuth state format');

  const [nonce, shop, ts, receivedHmac] = parts;
  const payload = `${nonce}:${shop}:${ts}`;
  const expectedHmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');

  if (expectedHmac !== receivedHmac) throw new Error('OAuth state HMAC verification failed');
  if (shop !== expectedShop) throw new Error('OAuth state shop domain mismatch');

  const age = Date.now() - parseInt(ts, 10);
  if (age > 10 * 60 * 1000) throw new Error('OAuth state expired (>10 min)');
}

export function getAuthUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.SHOPIFY_APP_API_KEY,
    scope: env.SHOPIFY_APP_SCOPES,
    redirect_uri: buildRedirectUri(),
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// The OAuth callback is a backend route (not a frontend SPA page like every
// other platform's OAuth flow) — Shopify's callback HMAC/state verification
// and the shadow-user provisioning all happen server-side, before any
// browser redirect to the frontend, so redirect_uri points at the backend
// API itself rather than env.FRONTEND_URL.
function buildRedirectUri(): string {
  return `${env.BACKEND_URL.replace(/\/$/, '')}/api/shopify/callback`;
}

// Verifies Shopify's OAuth callback query-string HMAC. Per Shopify's
// documented callback verification: take every query param except `hmac`
// and `signature`, sort by key, join as key=value pairs with `&`, HMAC-SHA256
// (hex digest) with the app's client secret, compare to the `hmac` param.
export function verifyCallbackHmac(query: Record<string, string>): boolean {
  const { hmac, signature: _signature, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');

  const expected = createHmac('sha256', env.SHOPIFY_APP_API_SECRET)
    .update(message)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(hmac, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<{ access_token: string; scope: string }> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_APP_API_KEY,
      client_secret: env.SHOPIFY_APP_API_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify OAuth token exchange failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<{ access_token: string; scope: string }>;
}
