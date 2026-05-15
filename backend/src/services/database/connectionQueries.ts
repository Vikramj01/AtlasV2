import { supabaseAdmin as supabase } from './supabase';
import type {
  PlatformConnection,
  PlatformConnectionPublic,
  Platform,
  ConnectionStatus,
  ConnectionType,
} from '@/types/connections';

// Strip the oauth_tokens field before returning to callers that build API responses
function toPublic(row: PlatformConnection): PlatformConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { oauth_tokens: _tokens, ...pub } = row;
  return pub as PlatformConnectionPublic;
}

// All columns except oauth_tokens — used in list/read queries so tokens
// never appear in query results passed to route handlers
const PUBLIC_COLUMNS =
  'id, organization_id, client_id, platform, connection_type, parent_connection_id, ' +
  'account_id, account_label, status, last_synced_at, last_error, metadata, created_at, updated_at';

// ── Read ───────────────────────────────────────────────────────────────────────

export async function listConnectionsForOrg(orgId: string): Promise<PlatformConnectionPublic[]> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select(PUBLIC_COLUMNS)
    .eq('organization_id', orgId)
    .order('platform')
    .order('connection_type')
    .order('created_at');

  if (error) throw new Error(`listConnectionsForOrg: ${error.message}`);
  return (data ?? []) as unknown as PlatformConnectionPublic[];
}

export async function getConnectionById(id: string, orgId: string): Promise<PlatformConnection | null> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) throw new Error(`getConnectionById: ${error.message}`);
  return data as unknown as PlatformConnection | null;
}

// Used internally by tokenManager — fetches full row including oauth_tokens
export async function getConnectionByIdInternal(id: string): Promise<PlatformConnection | null> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`getConnectionByIdInternal: ${error.message}`);
  return data as unknown as PlatformConnection | null;
}

export async function getChildConnections(parentId: string): Promise<PlatformConnectionPublic[]> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select(PUBLIC_COLUMNS)
    .eq('parent_connection_id', parentId)
    .order('account_label');

  if (error) throw new Error(`getChildConnections: ${error.message}`);
  return (data ?? []) as unknown as PlatformConnectionPublic[];
}

export async function getManagerConnections(
  orgId: string,
  platform: Platform,
): Promise<PlatformConnectionPublic[]> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select(PUBLIC_COLUMNS)
    .eq('organization_id', orgId)
    .eq('platform', platform)
    .eq('connection_type', 'manager')
    .order('created_at');

  if (error) throw new Error(`getManagerConnections: ${error.message}`);
  return (data ?? []) as unknown as PlatformConnectionPublic[];
}

// ── Write ──────────────────────────────────────────────────────────────────────

export interface UpsertConnectionInput {
  organization_id: string;
  client_id?: string | null;
  platform: Platform;
  connection_type: ConnectionType;
  parent_connection_id?: string | null;
  account_id: string;
  account_label?: string | null;
  oauth_tokens?: string | null;
  status: ConnectionStatus;
  metadata?: Record<string, unknown>;
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<PlatformConnectionPublic> {
  const { data, error } = await supabase
    .from('platform_connections')
    .upsert(
      {
        ...input,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,platform,account_id' },
    )
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) throw new Error(`upsertConnection: ${error.message}`);
  return data as unknown as PlatformConnectionPublic;
}

export async function updateConnectionStatus(
  id: string,
  status: ConnectionStatus,
  lastError?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('platform_connections')
    .update({
      status,
      last_error: lastError ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(`updateConnectionStatus: ${error.message}`);
}

export async function updateConnectionTokens(
  id: string,
  encryptedTokens: string,
): Promise<void> {
  const { error } = await supabase
    .from('platform_connections')
    .update({
      oauth_tokens: encryptedTokens,
      status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(`updateConnectionTokens: ${error.message}`);
}

export async function updateConnectionClientId(
  id: string,
  clientId: string,
): Promise<void> {
  const { error } = await supabase
    .from('platform_connections')
    .update({
      client_id: clientId,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(`updateConnectionClientId: ${error.message}`);
}

export async function updateLastSynced(id: string): Promise<void> {
  const { error } = await supabase
    .from('platform_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`updateLastSynced: ${error.message}`);
}

export async function deleteConnection(id: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('platform_connections')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) throw new Error(`deleteConnection: ${error.message}`);
}

// Marks all child connections of a manager as revoked when they are no longer
// returned by platform enumeration
export async function revokeStaleChildren(
  parentId: string,
  stillActiveAccountIds: string[],
): Promise<void> {
  if (stillActiveAccountIds.length === 0) {
    // Revoke everything under this parent
    const { error } = await supabase
      .from('platform_connections')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('parent_connection_id', parentId)
      .neq('status', 'active');  // preserve explicitly active connections
    if (error) throw new Error(`revokeStaleChildren: ${error.message}`);
    return;
  }

  const { error } = await supabase
    .from('platform_connections')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('parent_connection_id', parentId)
    .not('account_id', 'in', `(${stillActiveAccountIds.map((id) => `"${id}"`).join(',')})`)
    .eq('status', 'available');  // only revoke available rows, not active ones

  if (error) throw new Error(`revokeStaleChildren: ${error.message}`);
}

export { toPublic };
