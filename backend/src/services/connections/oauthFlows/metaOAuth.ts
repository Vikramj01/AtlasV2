import { createHmac, randomBytes } from 'crypto';
import { env } from '@/config/env';
import type { OAuthTokens } from '@/types/connections';

const SCOPES = ['ads_read', 'business_management'].join(',');
const AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth';
const TOKEN_URL = 'https://graph.facebook.com/v19.0/oauth/access_token';

// Meta long-lived tokens last 60 days. Refresh proactively at day 50.
const META_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/connections/oauth/meta/callback`;
}

export function generateState(clientId?: string): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const payload = `${nonce}:${clientId ?? ''}:${ts}`;
  const hmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

export function verifyState(state: string): { clientId?: string } {
  const decoded = Buffer.from(state, 'base64url').toString('utf8');
  const parts = decoded.split(':');
  if (parts.length !== 4) throw new Error('Invalid OAuth state format');

  const [nonce, clientId, ts, receivedHmac] = parts;
  const payload = `${nonce}:${clientId}:${ts}`;
  const expectedHmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');

  if (expectedHmac !== receivedHmac) throw new Error('OAuth state HMAC verification failed');

  const age = Date.now() - parseInt(ts, 10);
  if (age > 10 * 60 * 1000) throw new Error('OAuth state expired (>10 min)');

  return { clientId: clientId || undefined };
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: buildRedirectUri(),
    scope: SCOPES,
    state,
    response_type: 'code',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Exchanges the short-lived code for a long-lived token via two-step exchange.
export async function handleCallback(code: string): Promise<OAuthTokens> {
  // Step 1: exchange code for short-lived token
  const shortResponse = await fetch(
    `${TOKEN_URL}?` +
    `client_id=${encodeURIComponent(env.META_APP_ID)}&` +
    `client_secret=${encodeURIComponent(env.META_APP_SECRET)}&` +
    `redirect_uri=${encodeURIComponent(buildRedirectUri())}&` +
    `code=${encodeURIComponent(code)}`,
  );

  if (!shortResponse.ok) {
    const body = await shortResponse.text();
    throw new Error(`Meta OAuth short-lived token exchange failed (${shortResponse.status}): ${body}`);
  }

  const short = await shortResponse.json() as { access_token: string; token_type: string };

  // Step 2: exchange short-lived for long-lived token (~60 days)
  const longResponse = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&` +
    `client_id=${encodeURIComponent(env.META_APP_ID)}&` +
    `client_secret=${encodeURIComponent(env.META_APP_SECRET)}&` +
    `fb_exchange_token=${encodeURIComponent(short.access_token)}`,
  );

  if (!longResponse.ok) {
    const body = await longResponse.text();
    throw new Error(`Meta OAuth long-lived token exchange failed (${longResponse.status}): ${body}`);
  }

  const long = await longResponse.json() as {
    access_token: string;
    token_type: string;
    expires_in?: number;
  };

  return {
    access_token: long.access_token,
    expires_at: Date.now() + (long.expires_in ?? META_TOKEN_TTL_MS / 1000) * 1000,
    token_type: long.token_type,
  };
}
