/**
 * HubSpot OAuth — token exchange helpers, mirroring googleAdsOAuth.ts's shape.
 *
 * The route-level two-phase flow (discover accounts/pipelines before
 * persisting) lives in crm.ts, following the pattern the GTM OAuth Connect
 * UI sprint established (gtm.ts's /callback + /callback/finalize) — this
 * module only does state generation/verification and the raw token exchange,
 * same division of responsibility connections.ts uses for its own
 * oauthFlows/*.ts modules.
 *
 * HubSpot OAuth docs: https://developers.hubspot.com/docs/guides/api/app-management/oauth
 */

import { createHmac, randomBytes } from 'crypto';
import { env } from '@/config/env';
import type { OAuthTokens } from '@/types/connections';

const AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';

// Read-only scopes only for v1 — write-back (D3, Sprint 9) needs
// crm.objects.{deals,contacts}.write added, which will force a reconnect
// since HubSpot re-prompts consent on a widened scope set. Not requested
// now per YAGNI; add it when Sprint 9 actually ships write-back.
const SCOPES = [
  'crm.objects.deals.read',
  'crm.objects.contacts.read',
  'crm.schemas.deals.read',
  'crm.schemas.contacts.read',
].join(' ');

function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/crm/oauth/hubspot/callback`;
}

// HMAC-SHA256 state parameter for CSRF protection, carrying clientId through
// the redirect (same shape as googleAdsOAuth.ts's generateState/verifyState).
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
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid OAuth state encoding');
  }
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
    client_id: env.HUBSPOT_CLIENT_ID,
    redirect_uri: buildRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function handleCallback(code: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(),
      code,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot OAuth token exchange failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: SCOPES,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot OAuth token refresh failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: SCOPES,
  };
}
