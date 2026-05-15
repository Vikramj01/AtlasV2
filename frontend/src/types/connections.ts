export type Platform = 'google_ads' | 'meta' | 'ga4' | 'gtm_destinations';
export type ConnectionType = 'manager' | 'child' | 'standalone';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error' | 'available';

// Safe shape — no token fields ever reach the frontend
export interface PlatformConnectionPublic {
  id: string;
  organization_id: string;
  client_id: string | null;
  platform: Platform;
  connection_type: ConnectionType;
  parent_connection_id: string | null;
  account_id: string;
  account_label: string | null;
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConnectionGroup {
  manager: PlatformConnectionPublic;
  children: PlatformConnectionPublic[];
}

export interface ConnectionsResponse {
  google_ads: ConnectionGroup[];
  meta: ConnectionGroup[];
  ga4: PlatformConnectionPublic[];
  gtm_destinations: ConnectionGroup[];
  standalone: PlatformConnectionPublic[];
}

export interface DiscoveredAccount {
  account_id: string;
  account_label: string;
  platform: Platform;
  manager_account_id?: string;
  is_manager?: boolean;
  existing_connection_id?: string;
  existing_status?: ConnectionStatus;
}
