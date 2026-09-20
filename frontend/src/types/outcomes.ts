// Universal Outcome Ingestion types — mirrors backend/src/types/outcomes.ts.
// Formerly types/crm.ts, renamed while the underlying outcome_* tables
// were empty (docs/prd/universal-outcome-ingestion.md Phase 1).
// CrmProviderName stays as-is: renaming the provider/connector abstraction
// itself (CrmProvider -> OutcomeSource) is Phase 2's job, not this one.

export type CrmProviderName = 'hubspot' | 'salesforce';
export type OutcomeObjectType = 'contact' | 'deal';
export type OutcomeValueMode = 'DECLARED' | 'DERIVED';
export type OutcomeSyncStatus = 'ok' | 'partial' | 'failed';

export interface OutcomeSourceConfig {
  id: string;
  organization_id: string;
  client_id: string;
  connection_id: string;
  source_type: CrmProviderName;
  pipeline_id: string | null;
  tracked_object: OutcomeObjectType;
  identity_property_map: Record<string, string>;
  value_mode: OutcomeValueMode;
  default_currency: string;
  backfill_days: number;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  write_back_enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: OutcomeSyncStatus | null;
  last_sync_error: string | null;
  // Sprint 8 — reset to 0 on 'ok'/'partial', incremented on 'failed'.
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface CreateOutcomeSourceConfigInput {
  client_id: string;
  connection_id: string;
  source_type: CrmProviderName;
  pipeline_id?: string | null;
  tracked_object?: OutcomeObjectType;
  identity_property_map?: Record<string, string>;
  value_mode?: OutcomeValueMode;
  default_currency?: string;
  backfill_days?: number;
}

export interface UpdateOutcomeSourceConfigInput {
  pipeline_id?: string | null;
  tracked_object?: OutcomeObjectType;
  identity_property_map?: Record<string, string>;
  value_mode?: OutcomeValueMode;
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

// One row in the ladder editor — either a saved outcome_stage_mappings row
// or an objectMapper-built draft (which has no id/organization_id/config_id
// yet). Its own crm_stage_id/crm_stage_label fields are untouched by the
// Phase 1 rename — see backend's types/outcomes.ts header for why.
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

// outcome_derived_value_snapshots (§5.5, Sprint 7) — latest per-stage
// snapshot, whatever derivedValueCalculator.ts's weekly job last computed.
// Its own crm_stage_id column is untouched by the Phase 1 rename.
export interface OutcomeDerivedValueSnapshot {
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

// outcome_events (§5.4, Sprint 8 read surface) — mirrors backend/src/types/outcomes.ts.
export type OutcomeIdentityMethod = 'click_id' | 'hashed_email' | 'hashed_phone' | 'unresolved';
export type OutcomeDeliveryStatus =
  | 'pending' | 'delivered' | 'partial' | 'failed'
  | 'skipped_unresolved' | 'skipped_window' | 'dedup_skipped';

export interface OutcomeEvent {
  id: string;
  organization_id: string;
  client_id: string;
  config_id: string;
  mapping_id: string | null;
  source_record_id: string;
  source_object: OutcomeObjectType;
  source_stage_id: string;
  stage_changed_at: string;
  atlas_event_name: string;
  event_id: string;
  identity_method: OutcomeIdentityMethod;
  identity_key_present: string[];
  conversion_value: number | null;
  currency: string | null;
  value_source: ValueSource;
  derived_confidence: DerivedConfidence | null;
  delivery_status: OutcomeDeliveryStatus;
  delivery_detail: Record<string, unknown>;
  delivered_at: string | null;
  created_at: string;
}

export interface ListOutcomeEventsResult {
  rows: OutcomeEvent[];
  total: number;
}

// GET /configs/:id/outcomes/daily (Sprint 8) — real day-grouped counts
// backing OutcomesTab's chart (Implementation Rule 12).
export interface OutcomeDailyCount {
  date: string; // YYYY-MM-DD
  total: number;
  delivered: number;
}
