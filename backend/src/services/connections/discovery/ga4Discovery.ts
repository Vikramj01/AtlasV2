import type { OAuthTokens, DiscoveredAccount, PlatformConnectionPublic } from '@/types/connections';

const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';

interface GA4AccountSummary {
  name: string;           // "accountSummaries/123456"
  account: string;        // "accounts/123456"
  displayName: string;
  propertySummaries?: GA4PropertySummary[];
}

interface GA4PropertySummary {
  property: string;       // "properties/987654"
  displayName: string;
  propertyType?: string;  // "PROPERTY_TYPE_ORDINARY" | "PROPERTY_TYPE_ROLLUP" etc.
}

// Returns all GA4 properties the user has access to via accountSummaries.list.
// Each property becomes a standalone connection (GA4 has no Manager Account equivalent).
// Multiple properties from the same OAuth grant share the underlying refresh token
// (the token is stored on each standalone row for simplicity per PRD section 7.6).
export async function discoverProperties(
  tokens: OAuthTokens,
  existingConnections: PlatformConnectionPublic[],
): Promise<DiscoveredAccount[]> {
  const response = await fetch(`${ADMIN_BASE}/accountSummaries?pageSize=200`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GA4 accountSummaries.list failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    accountSummaries?: GA4AccountSummary[];
    nextPageToken?: string;
  };

  let summaries = json.accountSummaries ?? [];

  // Follow pagination
  let pageToken = json.nextPageToken;
  while (pageToken) {
    const page = await fetch(
      `${ADMIN_BASE}/accountSummaries?pageSize=200&pageToken=${encodeURIComponent(pageToken)}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!page.ok) break;
    const pageJson = await page.json() as {
      accountSummaries?: GA4AccountSummary[];
      nextPageToken?: string;
    };
    summaries = [...summaries, ...(pageJson.accountSummaries ?? [])];
    pageToken = pageJson.nextPageToken;
  }

  const existingByAccountId = new Map(
    existingConnections.map((c) => [c.account_id, c]),
  );

  const accounts: DiscoveredAccount[] = [];

  for (const accountSummary of summaries) {
    for (const prop of accountSummary.propertySummaries ?? []) {
      // "properties/987654" → "987654"
      const propertyId = prop.property.replace('properties/', '');
      const label = `${prop.displayName} (${accountSummary.displayName})`;
      const existing = existingByAccountId.get(propertyId);

      accounts.push({
        account_id: propertyId,
        account_label: label,
        platform: 'ga4',
        existing_connection_id: existing?.id,
        existing_status: existing?.status,
      });
    }
  }

  return accounts;
}
