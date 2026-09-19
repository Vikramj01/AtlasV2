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

// crm_outcome_events (§5.4) — written by crmSyncOrchestrator.ts (Sprint 4),
// read/updated by outcomeDelivery.ts (Sprint 5).
export type CrmIdentityMethod = 'click_id' | 'hashed_email' | 'hashed_phone' | 'unresolved';
export type CrmValueSource = 'DECLARED' | 'DERIVED' | 'CRM_AMOUNT' | 'NONE';
export type CrmDerivedConfidence = 'high' | 'low' | 'withheld';
export type CrmDeliveryStatus =
  | 'pending' | 'delivered' | 'partial' | 'failed'
  | 'skipped_unresolved' | 'skipped_window' | 'dedup_skipped';

export interface CrmOutcomeEvent {
  id: string;
  organization_id: string;
  client_id: string;
  config_id: string;
  mapping_id: string | null;
  crm_record_id: string;
  crm_object: CrmObjectType;
  crm_stage_id: string;
  stage_changed_at: string;
  atlas_event_name: string;
  event_id: string;
  identity_method: CrmIdentityMethod;
  identity_key_present: string[];
  conversion_value: number | null;
  currency: string | null;
  value_source: CrmValueSource;
  derived_confidence: CrmDerivedConfidence | null;
  delivery_status: CrmDeliveryStatus;
  delivery_detail: Record<string, unknown>;
  delivered_at: string | null;
  created_at: string;
}

// Row shape the orchestrator writes — organization_id is added by the query
// function from the config, not carried by the caller. delivery_status/
// delivery_detail/delivered_at reflect the REAL outcome of
// outcomeDelivery.ts's attempt (Sprint 5), made in-memory in the same pass
// as identity resolution — never a placeholder written first and patched
// later, since the raw (unhashed) identity values needed to attempt
// delivery are never persisted (§5.4's PII rule) and so cannot be re-read
// from the DB by a later step.
export interface NewCrmOutcomeEventInput {
  client_id: string;
  config_id: string;
  mapping_id: string;
  crm_record_id: string;
  crm_object: CrmObjectType;
  crm_stage_id: string;
  stage_changed_at: string;
  atlas_event_name: string;
  event_id: string;
  identity_method: CrmIdentityMethod;
  identity_key_present: string[];
  conversion_value: number | null;
  currency: string | null;
  value_source: CrmValueSource;
  derived_confidence: CrmDerivedConfidence | null;
  delivery_status: CrmDeliveryStatus;
  delivery_detail: Record<string, unknown>;
  delivered_at: string | null;
}
