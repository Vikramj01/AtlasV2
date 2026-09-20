// Universal Outcome Ingestion types — docs/prd/universal-outcome-ingestion.md
// Phase 1. Formerly types/crm.ts (docs/prd/crm-outcome-integration.md §5) —
// renamed while the underlying outcome_* tables were empty, per Phase 1's
// "the codebase currently names the universal outcome layer after one
// source type" rationale. CrmProviderName -> OutcomeSourceType renamed in
// Phase 2 (§5.2) alongside CrmProvider -> OutcomeSource (sources/types.ts).
// Widened in Phase 3 to include 'webhook' — the first non-CRM source type
// this union actually models. 'sheet'/'csv' (Phase 4) stay out until those
// sources are real, matching the same reasoning that kept this narrow in
// Phase 2.
export type OutcomeSourceType = 'hubspot' | 'salesforce' | 'webhook';
export type OutcomeObjectType = 'contact' | 'deal';
export type OutcomeValueMode = 'DECLARED' | 'DERIVED';
export type OutcomeSyncStatus = 'ok' | 'partial' | 'failed';

// Full DB row for outcome_source_configs (was crm_sync_configs).
export interface OutcomeSourceConfig {
  id: string;
  organization_id: string;
  client_id: string;
  // Nullable since Phase 3 (§6) — a webhook source has no OAuth connection
  // at all; Atlas receives calls rather than authenticating outward. Always
  // present for a pull source (hubspot/salesforce).
  connection_id: string | null;
  source_type: OutcomeSourceType;
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
  // Sprint 8 (§10) — reset to 0 on 'ok'/'partial', incremented on 'failed'.
  // The only persistent cross-run state this feature needs to detect
  // "failed on consecutive runs" without a dedicated run-history table.
  consecutive_failures: number;
  // Phase 3 (§6.1) — AES-256-GCM encrypted at rest (services/outcomes/
  // webhookAuth.ts), the same envelope shape api/routes/slack.ts already
  // uses for its own webhook-URL encryption. NULL for a pull source. Never
  // sent back over the API in plaintext after config creation — only the
  // creation response carries the real secret, once.
  webhook_secret_encrypted: string | null;
  // Phase 3 (§6.3) — deliberately separate from sync_enabled, which stays
  // pull-polling-specific and unchanged in meaning. Whether this source's
  // resolved records are actually attempted for live delivery, vs.
  // persisted and counted only. Auto-disabled by services/outcomes/
  // deliveryGate.ts the moment a delivery-enabled source's tier-3 rate
  // crosses threshold — see delivery_disabled_reason.
  delivery_enabled: boolean;
  // Set when the gate above auto-disables delivery; cleared back to NULL
  // the next time delivery_enabled is turned back on (by an operator or
  // otherwise). The sole "fully inspectable by an operator" surface for
  // this in Phase 3 — no dedicated health_alerts row yet.
  delivery_disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOutcomeSourceConfigInput {
  client_id: string;
  connection_id: string;
  source_type: OutcomeSourceType;
  pipeline_id?: string | null;
  tracked_object?: OutcomeObjectType;
  identity_property_map?: Record<string, string>;
  value_mode?: OutcomeValueMode;
  default_currency?: string;
  backfill_days?: number;
}

// Phase 3 — a webhook config's own creation shape, deliberately separate
// from CreateOutcomeSourceConfigInput above (which keeps connection_id
// required, unchanged, for the pull sources that still need it). See
// services/database/outcomeQueries.ts's createWebhookOutcomeSourceConfig().
export interface CreateWebhookOutcomeSourceConfigInput {
  client_id: string;
  tracked_object?: OutcomeObjectType;
  value_mode?: OutcomeValueMode;
  default_currency?: string;
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
  delivery_enabled?: boolean;
  delivery_disabled_reason?: string | null;
}

// Full DB row for outcome_stage_mappings — the ladder itself (§5.3). Its own
// crm_stage_id/crm_stage_label columns are untouched by the Phase 1 rename
// (they name the SOURCE's own stage identifier/label, not this layer).
export interface OutcomeStageMapping {
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

// outcome_events (§5.4, was crm_outcome_events) — written by
// syncOrchestrator.ts (Sprint 4), read/updated by outcomeDelivery.ts
// (Sprint 5).
export type OutcomeIdentityMethod = 'click_id' | 'hashed_email' | 'hashed_phone' | 'unresolved';
export type OutcomeValueSource = 'DECLARED' | 'DERIVED' | 'CRM_AMOUNT' | 'NONE';
export type OutcomeDerivedConfidence = 'high' | 'low' | 'withheld';
export type OutcomeDeliveryStatus =
  | 'pending' | 'delivered' | 'partial' | 'failed'
  | 'skipped_unresolved' | 'skipped_window' | 'dedup_skipped'
  // Phase 3 (§6.3) — identity resolved, but this source's delivery_enabled
  // is false (never turned on, or auto-disabled by the tier-3 gate).
  // Distinct from skipped_unresolved: here delivery WOULD have been
  // attempted if the gate allowed it.
  | 'skipped_delivery_disabled';

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
  value_source: OutcomeValueSource;
  derived_confidence: OutcomeDerivedConfidence | null;
  delivery_status: OutcomeDeliveryStatus;
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
export interface NewOutcomeEventInput {
  client_id: string;
  config_id: string;
  mapping_id: string;
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
  value_source: OutcomeValueSource;
  derived_confidence: OutcomeDerivedConfidence | null;
  delivery_status: OutcomeDeliveryStatus;
  delivery_detail: Record<string, unknown>;
  delivered_at: string | null;
}

// Sprint 6 lost-deal handling (§7.4) — one earlier outcome_events row for
// the same record, as much as outcomeDelivery.ts's handleLostDeal() needs of
// it. Read by a new outcomeQueries.ts query and passed through
// syncOrchestrator.ts; never a live re-delivery.
export interface EarlierDeliveredOutcome {
  mapping_id: string | null;
  event_id: string;
  delivery_detail: Record<string, unknown>;
}

// outcome_derived_value_snapshots (§5.5) — populated by
// derivedValueCalculator.ts (Sprint 7) on a weekly schedule, read by
// syncOrchestrator.ts (feeds valueLadder.ts's DERIVED branch) and GET
// /configs/:id/derived-values. Its own crm_stage_id column is untouched by
// the Phase 1 rename, same reasoning as OutcomeStageMapping above.
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
  confidence: OutcomeDerivedConfidence;
  window_start: string; // DATE
  window_end: string;   // DATE
  computed_at: string;
}

// Row shape derivedValueCalculator.ts writes — organization_id is added by
// the query function from the config, matching NewOutcomeEventInput's
// convention above.
export interface NewDerivedValueSnapshotInput {
  config_id: string;
  crm_stage_id: string;
  sample_size: number;
  reached_won_count: number;
  stage_to_won_rate: number;
  avg_won_amount: number;
  currency: string;
  derived_value: number;
  confidence: OutcomeDerivedConfidence;
  window_start: string; // DATE
  window_end: string;   // DATE
}

// One outcome_events row's worth of raw material for the calculator — never
// identity/PII fields, only what the stage-to-won-rate math needs.
export interface OutcomeEventForDerivedCalc {
  source_record_id: string;
  source_stage_id: string;
  mapping_id: string | null;
  conversion_value: number | null;
  currency: string | null;
  stage_changed_at: string;
}

// GET /configs/:id/outcomes/daily (Sprint 8, §10) — one real day-grouped
// row for OutcomesTab's chart. Per Implementation Rule 12, this only exists
// because there is a real query behind it (outcome_events grouped by day) —
// never a fabricated series.
export interface OutcomeDailyCount {
  date: string; // YYYY-MM-DD
  total: number;
  delivered: number;
}
