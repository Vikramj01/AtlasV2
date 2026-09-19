// CRM Outcome Integration types — mirrors backend/src/types/crm.ts.

export type CrmProviderName = 'hubspot' | 'salesforce';
export type CrmObjectType = 'contact' | 'deal';
export type CrmValueMode = 'DECLARED' | 'DERIVED';
export type CrmSyncStatus = 'ok' | 'partial' | 'failed';

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

export interface CrmAccountInfo {
  account_id: string;
  account_label: string;
}

export interface CrmPipelineStage {
  id: string;
  label: string;
  display_order: number;
}

export interface CrmPipeline {
  id: string;
  label: string;
  stages: CrmPipelineStage[];
}

export type ReadinessVerdict = 'READY' | 'PROPERTIES_PRESENT_NO_DATA' | 'PROPERTIES_ABSENT' | 'NOT_OBSERVED';

export interface ReadinessResult {
  verdict: ReadinessVerdict;
  present_properties: string[];
  missing_properties: string[];
  sample_size: number;
  message: string;
}
