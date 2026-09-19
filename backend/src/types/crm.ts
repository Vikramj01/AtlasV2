// CRM Outcome Integration types — docs/prd/crm-outcome-integration.md §5.

export type CrmProviderName = 'hubspot' | 'salesforce';
export type CrmObjectType = 'contact' | 'deal';
export type CrmValueMode = 'DECLARED' | 'DERIVED';
export type CrmSyncStatus = 'ok' | 'partial' | 'failed';

// Full DB row for crm_sync_configs.
export interface CrmSyncConfig {
  id: string;
  organization_id: string;
  client_id: string;
  connection_id: string;
  provider: CrmProviderName;
  pipeline_id: string | null;
  tracked_object: CrmObjectType;
  identity_property_map: Record<string, string>;
  value_mode: CrmValueMode;
  default_currency: string;
  backfill_days: number;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  write_back_enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: CrmSyncStatus | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCrmSyncConfigInput {
  client_id: string;
  connection_id: string;
  provider: CrmProviderName;
  pipeline_id?: string | null;
  tracked_object?: CrmObjectType;
  identity_property_map?: Record<string, string>;
  value_mode?: CrmValueMode;
  default_currency?: string;
  backfill_days?: number;
}

export interface UpdateCrmSyncConfigInput {
  pipeline_id?: string | null;
  tracked_object?: CrmObjectType;
  identity_property_map?: Record<string, string>;
  value_mode?: CrmValueMode;
  default_currency?: string;
  backfill_days?: number;
  sync_enabled?: boolean;
  sync_interval_minutes?: number;
  write_back_enabled?: boolean;
}
