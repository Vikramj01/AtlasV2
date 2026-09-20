/**
 * Salesforce OAuth — token exchange helpers, mirroring hubspotOAuth.ts's
 * shape (CRM Outcome Integration Sprint 10, D1 — "Salesforce as Sprint 10").
 *
 * Two structural differences from every other OAuth flow in this codebase,
 * both named as real risk by the PRD's D1 rationale ("Salesforce needs
 * sandbox-vs-production handling... and a different query language"):
 *
 * 1. Sandbox vs. production login host. Salesforce authorizes and issues/
 *    refreshes tokens against either `login.salesforce.com` (production/
 *    Developer Edition orgs) or `test.salesforce.com` (sandboxes) — there is
 *    no single fixed host the way HubSpot's `app.hubspot.com`/`api.hubapi.com`
 *    are fixed. `sandbox` is threaded through the OAuth state (alongside the
 *    existing `clientId`) so the callback and any later refresh use the same
 *    host the authorize step used.
 * 2. Per-org API base URL. Unlike HubSpot's fixed `api.hubapi.com`, every
 *    Salesforce org has its own REST API host, returned as `instance_url` in
 *    the SAME token response as `access_token` — the login host above is
 *    ONLY used for authorize/token/refresh; every actual data call
 *    (salesforceClient.ts) goes to `instance_url` instead. OAuthTokens
 *    (types/connections.ts) gained an optional `instance_url` field for
 *    this — every other provider simply never sets it.
 *
 * Also unlike HubSpot: Salesforce's standard token response has no
 * `expires_in` field at all — an access token's real lifetime is set by the
 * connected app's/org's session-timeout policy, not returned inline. This
 * mirrors tokenManager.ts's existing Meta-token precedent (refreshMetaToken's
 * `expires_in ?? 60 * 24 * 60 * 60` fallback) rather than inventing a new
 * pattern — a long, conservative estimate, since the actual expiry signal
 * this codebase acts on is a real 401 from a live call (crmSyncOrchestrator.ts
 * catches token-resolution/API failures already) or platform_connections.status
 * being set to 'expired'/'revoked' by the connection lifecycle job, not a
 * proactively-computed timestamp.
 *
 * This sandbox's egress proxy blocks login.salesforce.com/developer.salesforce.com
 * (same class of restriction as api.hubapi.com, per Key Technical Decision
 * §14/§24 and hubspotClient.ts's Sprint 9 note) — built from Salesforce's
 * standard, long-stable OAuth 2.0 Web Server Flow (unchanged for years,
 * unlike Google's Data Manager API), flagged here for live re-verification
 * before reaching a real client.
 */

import { createHmac, randomBytes } from 'crypto';
import { env } from '@/config/env';
import type { OAuthTokens } from '@/types/connections';

function loginHost(sandbox: boolean): string {
  return sandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
}

// `api` covers REST/SOQL access to standard + custom objects and fields;
// `refresh_token` (aliased `offline_access` in some Salesforce docs, but
// `refresh_token` is the literal scope name Salesforce's own docs use) is
// required to receive a refresh_token in the token response at all.
const SCOPES = 'api refresh_token';

function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/crm/oauth/salesforce/callback`;
}

// Makes the unset env vars a reliable off-switch rather than an accidental
// one — without this, pasting credentials into the deployment turns the
// entire (currently unwired) feature live with no code change or review.
function assertSalesforceCredentialsConfigured(): void {
  if (!env.SALESFORCE_CLIENT_ID || !env.SALESFORCE_CLIENT_SECRET) {
    throw new Error('Salesforce OAuth is not configured on this deployment (SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET unset)');
  }
}

// Mirrors hubspotOAuth.ts's generateState/verifyState exactly, with one
// extra field (sandbox) threaded through alongside clientId.
export function generateState(clientId?: string, sandbox = false): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const payload = `${nonce}:${clientId ?? ''}:${sandbox ? '1' : '0'}:${ts}`;
  const hmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

export function verifyState(state: string): { clientId?: string; sandbox: boolean } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid OAuth state encoding');
  }
  const parts = decoded.split(':');
  if (parts.length !== 5) throw new Error('Invalid OAuth state format');

  const [nonce, clientId, sandboxFlag, ts, receivedHmac] = parts;
  const payload = `${nonce}:${clientId}:${sandboxFlag}:${ts}`;
  const expectedHmac = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(payload)
    .digest('hex');

  if (expectedHmac !== receivedHmac) throw new Error('OAuth state HMAC verification failed');

  const age = Date.now() - parseInt(ts, 10);
  if (age > 10 * 60 * 1000) throw new Error('OAuth state expired (>10 min)');

  return { clientId: clientId || undefined, sandbox: sandboxFlag === '1' };
}

export function getAuthUrl(state: string, sandbox: boolean): string {
  assertSalesforceCredentialsConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SALESFORCE_CLIENT_ID,
    redirect_uri: buildRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `${loginHost(sandbox)}/services/oauth2/authorize?${params.toString()}`;
}

interface SalesforceTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  token_type: string;
  // Deliberately no expires_in — see module header.
}

// A long, conservative estimate (mirrors tokenManager.ts's own Meta-token
// fallback precedent) — never treated as the real expiry signal, only a
// placeholder OAuthTokens.expires_at requires a value.
const CONSERVATIVE_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

export async function handleCallback(code: string, sandbox: boolean): Promise<OAuthTokens> {
  assertSalesforceCredentialsConfigured();
  const response = await fetch(`${loginHost(sandbox)}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.SALESFORCE_CLIENT_ID,
      client_secret: env.SALESFORCE_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(),
      code,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Salesforce OAuth token exchange failed (${response.status}): ${body}`);
  }

  const json = await response.json() as SalesforceTokenResponse;

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    instance_url: json.instance_url,
    expires_at: Date.now() + CONSERVATIVE_EXPIRY_MS,
    token_type: json.token_type,
    scope: SCOPES,
  };
}

// Refresh always goes through the LOGIN host (not instance_url) — the
// caller must have remembered which host (production/sandbox) this
// connection was authorized against, since Salesforce's refresh endpoint
// is sandbox/production-specific like the authorize step, not per-org like
// the data API. Salesforce does not rotate refresh_token on refresh by
// default, so the current one is reused if the response omits it.
export async function refreshAccessToken(refreshToken: string, sandbox: boolean): Promise<OAuthTokens> {
  assertSalesforceCredentialsConfigured();
  const response = await fetch(`${loginHost(sandbox)}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.SALESFORCE_CLIENT_ID,
      client_secret: env.SALESFORCE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Salesforce OAuth token refresh failed (${response.status}): ${body}`);
  }

  const json = await response.json() as SalesforceTokenResponse;

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    instance_url: json.instance_url,
    expires_at: Date.now() + CONSERVATIVE_EXPIRY_MS,
    token_type: json.token_type,
    scope: SCOPES,
  };
}
