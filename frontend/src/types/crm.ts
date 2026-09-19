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
  // Sprint 8 — reset to 0 on 'ok'/'partial', incremented on 'failed'.
  consecutive_failures: number;
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

export type ValueSource = 'DECLARED' | 'DERIVED' | 'CRM_AMOUNT' | 'NONE';
export type DerivedConfidence = 'high' | 'low' | 'withheld';

export interface ValueResolution {
  value: number | null;
  currency: string | null;
  value_source: ValueSource;
  derived_confidence: DerivedConfidence | null;
}

// One row in the ladder editor — either a saved crm_stage_mappings row or an
// objectMapper-built draft (which has no id/organization_id/config_id yet).
export interface StageMappingRow {
  id?: string;
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
  outcomes_last_30d: number;
  resolved_value: ValueResolution;
}

export interface StageMappingsResponse {
  is_draft: boolean;
  mappings: StageMappingRow[];
}

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

// crm_derived_value_snapshots (§5.5, Sprint 7) — latest per-stage snapshot,
// whatever derivedValueCalculator.ts's weekly job last computed.
export interface CrmDerivedValueSnapshot {
  id: string;
  organization_id: string;
  config_id: string;
  crm_stage_id: string;
  sample_size: number;
  reached_won_count: number;
  stage_to_won_rate: number;
  avg_won_amount: number;
  currency: string;
  derived_value: number;
  confidence: DerivedConfidence;
  window_start: string;
  window_end: string;
  computed_at: string;
}

// crm_outcome_events (§5.4, Sprint 8 read surface) — mirrors backend/src/types/crm.ts.
export type CrmIdentityMethod = 'click_id' | 'hashed_email' | 'hashed_phone' | 'unresolved';
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
  value_source: ValueSource;
  derived_confidence: DerivedConfidence | null;
  delivery_status: CrmDeliveryStatus;
  delivery_detail: Record<string, unknown>;
  delivered_at: string | null;
  created_at: string;
}

export interface ListOutcomeEventsResult {
  rows: CrmOutcomeEvent[];
  total: number;
}

// GET /configs/:id/outcomes/daily (Sprint 8) — real day-grouped counts
// backing CrmOutcomesTab's chart (Implementation Rule 12).
export interface CrmDailyOutcomeCount {
  date: string; // YYYY-MM-DD
  total: number;
  delivered: number;
}
