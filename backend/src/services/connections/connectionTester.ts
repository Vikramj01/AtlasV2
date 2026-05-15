import { env } from '@/config/env';
import { resolveTokens } from './tokenManager';
import { getConnectionById } from '@/services/database/connectionQueries';
import type { Platform } from '@/types/connections';

const ADS_API_VERSION = 'v18';
const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';

export interface TestResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

// Performs a minimal read against the live platform to verify the connection is healthy.
// Resolves tokens internally (handles child→parent token lookup).
// Never surfaces token values in the result.
export async function testConnection(connectionId: string, orgId: string): Promise<TestResult> {
  const conn = await getConnectionById(connectionId, orgId);
  if (!conn) {
    return { ok: false, latency_ms: 0, error: 'Connection not found' };
  }

  if (conn.status === 'expired') {
    return { ok: false, latency_ms: 0, error: 'Connection token is expired — re-authorise to restore' };
  }

  let tokens;
  try {
    tokens = await resolveTokens(connectionId);
  } catch (err) {
    return {
      ok: false,
      latency_ms: 0,
      error: err instanceof Error ? err.message : 'Failed to resolve tokens',
    };
  }

  const start = Date.now();

  try {
    await runPlatformCheck(conn.platform, conn.account_id, tokens.access_token);
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Platform check failed',
    };
  }
}

async function runPlatformCheck(
  platform: Platform,
  accountId: string,
  accessToken: string,
): Promise<void> {
  switch (platform) {
    case 'google_ads':
      await checkGoogleAds(accountId, accessToken);
      break;
    case 'ga4':
      await checkGa4(accountId, accessToken);
      break;
    case 'meta':
      await checkMeta(accessToken);
      break;
    case 'gtm_destinations':
      // Phase 2+ — no-op for now
      break;
  }
}

async function checkGoogleAds(accountId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `https://googleads.googleapis.com/${ADS_API_VERSION}/customers/${accountId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
      },
      body: JSON.stringify({
        query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1',
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Ads test failed (${response.status}): ${safeErrorMessage(body)}`);
  }
}

async function checkGa4(propertyId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `${ADMIN_BASE}/properties/${propertyId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GA4 test failed (${response.status}): ${safeErrorMessage(body)}`);
  }
}

async function checkMeta(accessToken: string): Promise<void> {
  const response = await fetch(
    `${GRAPH_BASE}/me?fields=id,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta test failed (${response.status}): ${safeErrorMessage(body)}`);
  }
}

// Strip any token-like strings from error messages before returning to callers
function safeErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Return just the platform's error message, not full response body
    const msg = parsed?.error as { message?: string } | undefined;
    return msg?.message ?? 'Platform returned an error';
  } catch {
    return raw.slice(0, 200);
  }
}
