import { env } from '@/config/env';
import type { OAuthTokens, DiscoveredAccount, PlatformConnectionPublic } from '@/types/connections';

const ADS_API_VERSION = 'v18';
const ADS_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

// Runs the customer_client GAQL query against a Manager Account to enumerate
// every directly-accessible child account (level <= 1 = immediate children only).
export async function discoverChildAccounts(
  managerAccountId: string,
  tokens: OAuthTokens,
  existingConnections: PlatformConnectionPublic[],
): Promise<DiscoveredAccount[]> {
  const query =
    'SELECT customer_client.client_customer, customer_client.descriptive_name, ' +
    'customer_client.id, customer_client.manager, customer_client.status ' +
    'FROM customer_client WHERE customer_client.level <= 1';

  const response = await fetch(
    `${ADS_BASE}/customers/${managerAccountId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: buildHeaders(tokens.access_token, managerAccountId),
      body: JSON.stringify({ query }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Ads customer_client query failed (${response.status}): ${body}`);
  }

  // searchStream returns a JSON array of result batches
  const batches = await response.json() as Array<{
    results?: Array<{
      customerClient: {
        clientCustomer: string;   // "customers/123456789"
        descriptiveName?: string;
        id: string;
        manager?: boolean;
        status?: string;
      };
    }>;
  }>;

  const existingByAccountId = new Map(
    existingConnections.map((c) => [c.account_id, c]),
  );

  const accounts: DiscoveredAccount[] = [];

  for (const batch of batches) {
    for (const row of batch.results ?? []) {
      const cc = row.customerClient;
      // Exclude the manager itself and any sub-managers in the tree
      if (cc.manager) continue;

      const accountId = cc.id;
      const existing = existingByAccountId.get(accountId);

      accounts.push({
        account_id: accountId,
        account_label: cc.descriptiveName ?? accountId,
        platform: 'google_ads',
        manager_account_id: managerAccountId,
        is_manager: false,
        existing_connection_id: existing?.id,
        existing_status: existing?.status,
      });
    }
  }

  return accounts;
}

// Resolves the caller's own Google Ads customer ID from the access token.
// Used to determine the Manager Account ID after OAuth when the user hasn't
// provided it explicitly.
export async function resolveManagerAccountId(tokens: OAuthTokens): Promise<string | null> {
  const response = await fetch(`${ADS_BASE}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    },
  });

  if (!response.ok) return null;

  const json = await response.json() as { resourceNames?: string[] };
  const names = json.resourceNames ?? [];
  if (names.length === 0) return null;

  // Returns "customers/123456789" — extract the numeric ID
  return names[0].replace('customers/', '');
}

function buildHeaders(
  accessToken: string,
  loginCustomerId: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'login-customer-id': loginCustomerId,
  };
}
