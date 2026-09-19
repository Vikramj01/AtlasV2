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

// Full DB row for crm_stage_mappings — the ladder itself (§5.3).
export interface CrmStageMapping {
  id: string;
  organization_id: string;
  config_id: string;
  crm_stage_id: string;
  crm_stage_label: string;
  stage_order: number;
  atlas_event_name: string;
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
  declared_value: number | null;
  currency: string | null;
  google_conversion_action_id: string | null;
  meta_event_name: string | null;
  linkedin_conversion_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// One stage's desired shape for PUT /configs/:id/stage-mappings — the
// operator-submitted (or objectMapper-defaulted) ladder, pre-persistence.
export interface StageMappingInput {
  crm_stage_id: string;
  crm_stage_label?: string;
  stage_order: number;
  atlas_event_name: string;
  is_terminal_won?: boolean;
  is_terminal_lost?: boolean;
  declared_value?: number | null;
  currency?: string | null;
  google_conversion_action_id?: string | null;
  meta_event_name?: string | null;
  linkedin_conversion_id?: string | null;
  enabled?: boolean;
}
