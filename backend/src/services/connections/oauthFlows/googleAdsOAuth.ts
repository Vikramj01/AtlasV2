import { createHmac, randomBytes } from 'crypto';
import { env } from '@/config/env';
import type { OAuthTokens } from '@/types/connections';

// Combined scopes: Google Ads + GA4 share one Google OAuth consent screen
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics',
].join(' ');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// Redirect URI points to the frontend SPA callback page, which reads code+state
// from the URL and calls POST /api/connections/oauth/google_ads/callback.
function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/connections/oauth/google_ads/callback`;
}

// HMAC-SHA256 state parameter for CSRF protection.
// state = nonce:clientId:timestamp:hmac
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
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: buildRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function handleCallback(code: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  if (!json.refresh_token) {
    throw new Error('Google OAuth: no refresh_token returned. Ensure prompt=consent is set and the user has not previously authorised without offline access.');
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: json.scope,
  };
}
