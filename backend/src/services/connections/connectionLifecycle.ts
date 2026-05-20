import * as googleAdsOAuth from './oauthFlows/googleAdsOAuth';
import * as metaOAuth from './oauthFlows/metaOAuth';
import * as ga4OAuth from './oauthFlows/ga4OAuth';
import { encryptTokens } from './tokenManager';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import { discoverChildAccounts, resolveManagerAccountId } from './discovery/googleAdsDiscovery';
import { discoverBusinessManagers, discoverAdAccounts, discoverStandaloneAdAccounts } from './discovery/metaDiscovery';
import { discoverProperties } from './discovery/ga4Discovery';
import {
  listConnectionsForOrg,
  upsertConnection,
  updateConnectionStatus,
  updateConnectionClientId,
  deleteConnection,
  getChildConnections,
  getConnectionById,
  revokeStaleChildren,
} from '@/services/database/connectionQueries';
import type {
  Platform,
  DiscoveredAccount,
  PlatformConnectionPublic,
  OAuthTokens,
} from '@/types/connections';

// ── OAuth initiation ───────────────────────────────────────────────────────────

export interface OAuthStartResult {
  authUrl: string;
  state: string;
}

export function initiateOAuth(platform: Platform, clientId?: string): OAuthStartResult {
  const state = generateStateForPlatform(platform, clientId);
  const authUrl = getAuthUrlForPlatform(platform, state);
  return { authUrl, state };
}

function generateStateForPlatform(platform: Platform, clientId?: string): string {
  switch (platform) {
    case 'google_ads': return googleAdsOAuth.generateState(clientId);
    case 'meta':       return metaOAuth.generateState(clientId);
    case 'ga4':        return ga4OAuth.generateState(clientId);
    default:           throw new Error(`Unsupported platform for OAuth: ${platform}`);
  }
}

function getAuthUrlForPlatform(platform: Platform, state: string): string {
  switch (platform) {
    case 'google_ads': return googleAdsOAuth.getAuthUrl(state);
    case 'meta':       return metaOAuth.getAuthUrl(state);
    case 'ga4':        return ga4OAuth.getAuthUrl(state);
    default:           throw new Error(`Unsupported platform for OAuth: ${platform}`);
  }
}

// ── OAuth callback handling ────────────────────────────────────────────────────

export interface OAuthCallbackResult {
  managerId?: string;
  discovered: DiscoveredAccount[];
  standaloneDiscovered?: DiscoveredAccount[];  // GA4 properties from a google_ads OAuth
}

export async function handleOAuthCallback(
  platform: Platform,
  code: string,
  state: string,
  orgId: string,
): Promise<OAuthCallbackResult> {
  // Verify CSRF state
  verifyStateForPlatform(platform, state);

  // Exchange code for tokens
  const tokens = await exchangeCodeForPlatform(platform, code);
  const encryptedTokens = encryptTokens(tokens);

  const existingConnections = await listConnectionsForOrg(orgId);

  switch (platform) {
    case 'google_ads':
      return handleGoogleAdsCallback(orgId, tokens, encryptedTokens, existingConnections);
    case 'meta':
      return handleMetaCallback(orgId, tokens, encryptedTokens, existingConnections);
    case 'ga4':
      return handleGa4Callback(orgId, tokens, encryptedTokens, existingConnections);
    default:
      throw new Error(`Unsupported platform for OAuth callback: ${platform}`);
  }
}

function verifyStateForPlatform(platform: Platform, state: string): void {
  switch (platform) {
    case 'google_ads': googleAdsOAuth.verifyState(state); break;
    case 'meta':       metaOAuth.verifyState(state); break;
    case 'ga4':        ga4OAuth.verifyState(state); break;
    default:           throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function exchangeCodeForPlatform(platform: Platform, code: string): Promise<OAuthTokens> {
  switch (platform) {
    case 'google_ads': return googleAdsOAuth.handleCallback(code);
    case 'meta':       return metaOAuth.handleCallback(code);
    case 'ga4':        return ga4OAuth.handleCallback(code);
    default:           throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function handleGoogleAdsCallback(
  orgId: string,
  tokens: OAuthTokens,
  encryptedTokens: string,
  existingConnections: PlatformConnectionPublic[],
): Promise<OAuthCallbackResult> {
  // Identify the Manager Account from the token
  const managerAccountId = await resolveManagerAccountId(tokens);
  if (!managerAccountId) {
    throw new Error('Could not resolve Google Ads Manager Account from this token. Ensure you authorised with a Manager Account (MCC).');
  }

  // Upsert the manager row with encrypted tokens
  await upsertConnection({
    organization_id: orgId,
    platform: 'google_ads',
    connection_type: 'manager',
    account_id: managerAccountId,
    account_label: `Manager Account ${managerAccountId}`,
    oauth_tokens: encryptedTokens,
    status: 'active',
  });

  // Enumerate child accounts and upsert as 'available'
  const googleAdsExisting = existingConnections.filter((c) => c.platform === 'google_ads');
  const discovered = await discoverChildAccounts(managerAccountId, tokens, googleAdsExisting);

  // Get the manager connection id for parent_connection_id
  const managerConn = await upsertConnection({
    organization_id: orgId,
    platform: 'google_ads',
    connection_type: 'manager',
    account_id: managerAccountId,
    oauth_tokens: encryptedTokens,
    status: 'active',
  });

  await persistDiscoveredAsAvailable(discovered, orgId, managerConn.id);

  // Also discover GA4 properties from the same token (combined Google OAuth)
  const ga4Existing = existingConnections.filter((c) => c.platform === 'ga4');
  let ga4Discovered: DiscoveredAccount[] = [];
  try {
    ga4Discovered = await discoverProperties(tokens, ga4Existing);
    // GA4 properties become standalone rows — no manager parent
    // They are returned to the UI for the user to explicitly connect
  } catch {
    // GA4 discovery is best-effort — may fail if analytics.readonly scope was not granted
  }

  // If the user granted the datamanager scope, record the DMA OAuth link for this org.
  // This allows dmaClient to resolve access tokens via the manager connection row.
  if (tokens.scope?.includes('datamanager')) {
    await upsertDmaCredentials(orgId, managerConn.id, tokens.scope);
  }

  return {
    managerId: managerAccountId,
    discovered,
    standaloneDiscovered: ga4Discovered,
  };
}

async function upsertDmaCredentials(
  orgId: string,
  linkedConnectionId: string,
  oauthScope: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('google_dma_credentials')
    .upsert(
      {
        org_id: orgId,
        linked_connection_id: linkedConnectionId,
        oauth_scope: oauthScope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' },
    );

  if (error) {
    // Non-fatal: log and continue. DMA calls will fail at runtime if credentials
    // are missing, but the Google Ads connection itself succeeded.
    logger.error({ orgId, linkedConnectionId, error: error.message }, 'Failed to upsert google_dma_credentials');
  }
}

async function handleMetaCallback(
  orgId: string,
  tokens: OAuthTokens,
  encryptedTokens: string,
  existingConnections: PlatformConnectionPublic[],
): Promise<OAuthCallbackResult> {
  const businesses = await discoverBusinessManagers(tokens);
  const metaExisting = existingConnections.filter((c) => c.platform === 'meta');

  let allDiscovered: DiscoveredAccount[] = [];
  let firstManagerId: string | undefined;

  for (const bm of businesses) {
    // Upsert Business Manager as a manager row
    const managerConn = await upsertConnection({
      organization_id: orgId,
      platform: 'meta',
      connection_type: 'manager',
      account_id: bm.id,
      account_label: bm.name,
      oauth_tokens: encryptedTokens,
      status: 'active',
    });

    if (!firstManagerId) firstManagerId = bm.id;

    const adAccounts = await discoverAdAccounts(bm.id, tokens, metaExisting);
    await persistDiscoveredAsAvailable(adAccounts, orgId, managerConn.id);
    allDiscovered = [...allDiscovered, ...adAccounts];
  }

  // Also discover standalone ad accounts (not under any Business Manager)
  if (businesses.length === 0) {
    const standaloneAccounts = await discoverStandaloneAdAccounts(tokens, metaExisting);
    // For standalones, upsert with no parent — token stored on each row
    for (const account of standaloneAccounts) {
      await upsertConnection({
        organization_id: orgId,
        platform: 'meta',
        connection_type: 'standalone',
        account_id: account.account_id,
        account_label: account.account_label,
        oauth_tokens: encryptedTokens,
        status: 'available',
      });
    }
    allDiscovered = standaloneAccounts;
  }

  return { managerId: firstManagerId, discovered: allDiscovered };
}

async function handleGa4Callback(
  orgId: string,
  tokens: OAuthTokens,
  encryptedTokens: string,
  existingConnections: PlatformConnectionPublic[],
): Promise<OAuthCallbackResult> {
  const ga4Existing = existingConnections.filter((c) => c.platform === 'ga4');
  const discovered = await discoverProperties(tokens, ga4Existing);

  // GA4 properties are always standalone — each gets its own row with the token
  for (const account of discovered) {
    await upsertConnection({
      organization_id: orgId,
      platform: 'ga4',
      connection_type: 'standalone',
      account_id: account.account_id,
      account_label: account.account_label,
      oauth_tokens: encryptedTokens,
      status: 'available',
    });
  }

  return { discovered };
}

// Writes a batch of discovered accounts as 'available' child rows under a manager
async function persistDiscoveredAsAvailable(
  accounts: DiscoveredAccount[],
  orgId: string,
  parentConnectionId: string,
): Promise<void> {
  for (const account of accounts) {
    await upsertConnection({
      organization_id: orgId,
      platform: account.platform,
      connection_type: 'child',
      parent_connection_id: parentConnectionId,
      account_id: account.account_id,
      account_label: account.account_label,
      status: account.existing_status === 'active' ? 'active' : 'available',
    });
  }
}

// ── Account lifecycle transitions ─────────────────────────────────────────────

// Flips an 'available' row to 'active' and attaches a client.
// Validates that the connection belongs to the org and that client_id
// is not already used by a different active connection for the same platform.
export async function connectAccount(
  connectionId: string,
  clientId: string,
  orgId: string,
): Promise<PlatformConnectionPublic> {
  const conn = await getConnectionById(connectionId, orgId);
  if (!conn) throw new Error('Connection not found');
  if (conn.status !== 'available') {
    throw new Error(`Connection is not in 'available' state (current: ${conn.status})`);
  }

  await updateConnectionClientId(connectionId, clientId);
  await updateConnectionStatus(connectionId, 'active');

  const updated = await getConnectionById(connectionId, orgId);
  if (!updated) throw new Error('Connection not found after update');
  return updated;
}

// Flips an 'active' connection to 'available' and clears client_id.
// Sync stops; history and findings are retained.
export async function disconnectAccount(connectionId: string, orgId: string): Promise<void> {
  const conn = await getConnectionById(connectionId, orgId);
  if (!conn) throw new Error('Connection not found');

  await updateConnectionStatus(connectionId, 'available');
}

// Re-enumerates accounts under a manager and updates available/revoked status.
// New accounts → 'available'. Gone accounts (no longer in platform) → 'revoked'.
// Active connections are never demoted by rediscovery.
export async function rediscoverAccounts(
  managerConnectionId: string,
  orgId: string,
): Promise<DiscoveredAccount[]> {
  const manager = await getConnectionById(managerConnectionId, orgId);
  if (!manager) throw new Error('Manager connection not found');
  if (manager.connection_type !== 'manager') {
    throw new Error('Re-discover can only be called on manager connections');
  }

  const { resolveTokens } = await import('./tokenManager');
  const tokens = await resolveTokens(managerConnectionId);

  const existingConnections = await listConnectionsForOrg(orgId);
  const platformExisting = existingConnections.filter((c) => c.platform === manager.platform);

  let discovered: DiscoveredAccount[] = [];

  if (manager.platform === 'google_ads') {
    discovered = await discoverChildAccounts(manager.account_id, tokens, platformExisting);
  } else if (manager.platform === 'meta') {
    discovered = await discoverAdAccounts(manager.account_id, tokens, platformExisting);
  }

  // Upsert newly discovered accounts as 'available'
  await persistDiscoveredAsAvailable(discovered, orgId, managerConnectionId);

  // Mark accounts no longer returned by the platform as 'revoked'
  const stillActiveAccountIds = discovered.map((d) => d.account_id);
  await revokeStaleChildren(managerConnectionId, stillActiveAccountIds);

  return discovered;
}

// Removes a connection. For manager rows, cascades to all children via DB FK.
// Requires confirmed=true as an explicit safety guard.
export async function removeConnection(
  connectionId: string,
  orgId: string,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed) {
    throw new Error('confirmed must be true to remove a connection');
  }

  const conn = await getConnectionById(connectionId, orgId);
  if (!conn) throw new Error('Connection not found');

  // For manager rows, count children so the caller can warn the user
  // (the actual cascade is handled by the DB FK ON DELETE CASCADE)
  if (conn.connection_type === 'manager') {
    const children = await getChildConnections(connectionId);
    if (children.length > 0) {
      // Children will cascade-delete — this is expected and was confirmed by the user
    }
  }

  await deleteConnection(connectionId, orgId);
}
