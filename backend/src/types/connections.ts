export type Platform = 'google_ads' | 'meta' | 'ga4' | 'gtm_destinations';
export type ConnectionType = 'manager' | 'child' | 'standalone';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error' | 'available';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;   // unix ms
  token_type: string;
  scope?: string;
}

// Full DB row — oauth_tokens is the encrypted TEXT blob (never sent to client)
export interface PlatformConnection {
  id: string;
  organization_id: string;
  client_id: string | null;
  platform: Platform;
  connection_type: ConnectionType;
  parent_connection_id: string | null;
  account_id: string;
  account_label: string | null;
  oauth_tokens: string | null;
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Safe shape returned to frontend — tokens field stripped
export type PlatformConnectionPublic = Omit<PlatformConnection, 'oauth_tokens'>;

// One manager + its discovered child accounts
export interface ConnectionGroup {
  manager: PlatformConnectionPublic;
  children: PlatformConnectionPublic[];
}

// Top-level response for GET /api/connections
export interface ConnectionsResponse {
  google_ads: ConnectionGroup[];
  meta: ConnectionGroup[];
  ga4: PlatformConnectionPublic[];
  gtm_destinations: ConnectionGroup[];
  standalone: PlatformConnectionPublic[];
}

// A discovered child account returned from platform API enumeration
export interface DiscoveredAccount {
  account_id: string;
  account_label: string;
  platform: Platform;
  manager_account_id?: string;
  is_manager?: boolean;
  existing_connection_id?: string;
  existing_status?: ConnectionStatus;
}
