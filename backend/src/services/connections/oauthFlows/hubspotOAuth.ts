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

// Sprint 9 shipped writeAttribution() (D3), so the write scopes below are
// now requested — write-back would otherwise 403 against a real portal
// despite the code path being correct. A connection made before this
// change was authorized under the old read-only scope set and must be
// reconnected (HubSpot re-prompts consent on a widened scope) before its
// write_back_enabled toggle can actually work; there is no way to silently
// upgrade an already-granted OAuth grant's scopes after the fact.
const SCOPES = [
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.deals.read',
  'crm.schemas.contacts.read',
].join(' ');

function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/crm/oauth/hubspot/callback`;
}

// Makes the unset env vars a reliable off-switch rather than an accidental
// one — without this, pasting credentials into the deployment turns the
// entire (currently unwired) feature live with no code change or review.
function assertHubspotCredentialsConfigured(): void {
  if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) {
    throw new Error('HubSpot OAuth is not configured on this deployment (HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET unset)');
  }
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
  assertHubspotCredentialsConfigured();
  const params = new URLSearchParams({
    client_id: env.HUBSPOT_CLIENT_ID,
    redirect_uri: buildRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function handleCallback(code: string): Promise<OAuthTokens> {
  assertHubspotCredentialsConfigured();
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
  assertHubspotCredentialsConfigured();
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
