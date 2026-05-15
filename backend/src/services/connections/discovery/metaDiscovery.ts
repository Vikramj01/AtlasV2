import type { OAuthTokens, DiscoveredAccount, PlatformConnectionPublic } from '@/types/connections';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

interface MetaBusiness {
  id: string;
  name: string;
}

interface MetaAdAccount {
  id: string;        // "act_123456789"
  name: string;
  account_status: number;  // 1=ACTIVE, 2=DISABLED, etc.
  currency: string;
}

// Returns all Business Managers the authenticated user has access to.
export async function discoverBusinessManagers(tokens: OAuthTokens): Promise<MetaBusiness[]> {
  const response = await fetch(
    `${GRAPH_BASE}/me/businesses?fields=id,name&limit=100`,
    { headers: authHeader(tokens.access_token) },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta /me/businesses failed (${response.status}): ${body}`);
  }

  const json = await response.json() as { data?: MetaBusiness[] };
  return json.data ?? [];
}

// Returns all ad accounts under a given Business Manager.
// Combines owned accounts and client accounts.
export async function discoverAdAccounts(
  businessManagerId: string,
  tokens: OAuthTokens,
  existingConnections: PlatformConnectionPublic[],
): Promise<DiscoveredAccount[]> {
  const [owned, client] = await Promise.all([
    fetchAdAccounts(`${GRAPH_BASE}/${businessManagerId}/owned_ad_accounts`, tokens.access_token),
    fetchAdAccounts(`${GRAPH_BASE}/${businessManagerId}/client_ad_accounts`, tokens.access_token),
  ]);

  const all = deduplicateAdAccounts([...owned, ...client]);
  return mapToDiscovered(all, existingConnections, businessManagerId);
}

// Returns ad accounts not under any Business Manager — these become standalone connections.
export async function discoverStandaloneAdAccounts(
  tokens: OAuthTokens,
  existingConnections: PlatformConnectionPublic[],
): Promise<DiscoveredAccount[]> {
  const accounts = await fetchAdAccounts(
    `${GRAPH_BASE}/me/adaccounts?fields=id,name,account_status,currency`,
    tokens.access_token,
  );
  return mapToDiscovered(accounts, existingConnections);
}

async function fetchAdAccounts(url: string, accessToken: string): Promise<MetaAdAccount[]> {
  const fullUrl = url.includes('?')
    ? `${url}&fields=id,name,account_status,currency&limit=200`
    : `${url}?fields=id,name,account_status,currency&limit=200`;

  const response = await fetch(fullUrl, { headers: authHeader(accessToken) });

  if (!response.ok) {
    // Non-fatal: some BMs may return 403 for client accounts if permissions differ
    return [];
  }

  const json = await response.json() as { data?: MetaAdAccount[]; paging?: { next?: string } };
  let results = json.data ?? [];

  // Follow pagination
  let nextUrl = json.paging?.next;
  while (nextUrl) {
    const page = await fetch(nextUrl, { headers: authHeader(accessToken) });
    if (!page.ok) break;
    const pageJson = await page.json() as { data?: MetaAdAccount[]; paging?: { next?: string } };
    results = [...results, ...(pageJson.data ?? [])];
    nextUrl = pageJson.paging?.next;
  }

  return results;
}

function deduplicateAdAccounts(accounts: MetaAdAccount[]): MetaAdAccount[] {
  const seen = new Set<string>();
  return accounts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function mapToDiscovered(
  accounts: MetaAdAccount[],
  existingConnections: PlatformConnectionPublic[],
  businessManagerId?: string,
): DiscoveredAccount[] {
  const existingByAccountId = new Map(
    existingConnections.map((c) => [c.account_id, c]),
  );

  return accounts.map((a) => {
    // Strip the "act_" prefix for storage as account_id (plain numeric ID)
    const accountId = a.id.startsWith('act_') ? a.id.slice(4) : a.id;
    const existing = existingByAccountId.get(accountId);

    return {
      account_id: accountId,
      account_label: a.name,
      platform: 'meta' as const,
      manager_account_id: businessManagerId,
      existing_connection_id: existing?.id,
      existing_status: existing?.status,
    };
  });
}

function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}
