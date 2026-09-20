-- Universal Outcome Ingestion Phase 1 — rename the CRM-specific universal
-- outcome layer while its tables are still empty (docs/prd/universal-outcome-ingestion.md).
-- Verified immediately before writing this migration: all four crm_* tables
-- are at zero rows in production, health_alerts holds zero 'dqm_crm_sync'
-- rows, and dqm_run_log holds zero 'crm_sync' rows — a pure DDL rename,
-- no data migration.

-- ── Tables ───────────────────────────────────────────────────────────────────
ALTER TABLE crm_sync_configs RENAME TO outcome_source_configs;
ALTER TABLE crm_stage_mappings RENAME TO outcome_stage_mappings;
ALTER TABLE crm_outcome_events RENAME TO outcome_events;
ALTER TABLE crm_derived_value_snapshots RENAME TO outcome_derived_value_snapshots;

-- ── Indexes (the 7 plain idx_* indexes only — pkeys/unique-constraint/FK
--    index names are left as-is; Postgres RENAME COLUMN below already keeps
--    their definitions correct regardless of their old names) ────────────────
ALTER INDEX idx_crm_sync_configs_org RENAME TO idx_outcome_source_configs_org;
ALTER INDEX idx_crm_sync_configs_connection RENAME TO idx_outcome_source_configs_connection;
ALTER INDEX idx_crm_stage_mappings_config RENAME TO idx_outcome_stage_mappings_config;
ALTER INDEX idx_crm_outcome_events_config_created RENAME TO idx_outcome_events_config_created;
ALTER INDEX idx_crm_outcome_events_client RENAME TO idx_outcome_events_client;
ALTER INDEX idx_crm_outcome_events_delivery_status RENAME TO idx_outcome_events_delivery_status;
ALTER INDEX idx_crm_derived_value_snapshots_config RENAME TO idx_outcome_derived_value_snapshots_config;

-- ── Column renames ───────────────────────────────────────────────────────────
-- outcome_stage_mappings.crm_stage_id/crm_stage_label and
-- outcome_derived_value_snapshots.crm_stage_id are deliberately NOT renamed —
-- they name the SOURCE's own stage identifier/label, not this universal
-- layer, and stay meaningful for any future non-CRM source too.

ALTER TABLE outcome_source_configs RENAME COLUMN provider TO source_type;

ALTER TABLE outcome_events RENAME COLUMN crm_record_id TO source_record_id;
ALTER TABLE outcome_events RENAME COLUMN crm_object TO source_object;
ALTER TABLE outcome_events RENAME COLUMN crm_stage_id TO source_stage_id;

-- ── Widen outcome_source_configs.source_type (was provider) ─────────────────
-- Widened now rather than in a later phase, per the PRD, to avoid a second
-- constraint migration once the webhook/sheet/csv sources ship.
ALTER TABLE outcome_source_configs DROP CONSTRAINT crm_sync_configs_provider_check;
ALTER TABLE outcome_source_configs ADD CONSTRAINT outcome_source_configs_source_type_check
  CHECK (source_type = ANY (ARRAY['hubspot'::text, 'salesforce'::text, 'webhook'::text, 'sheet'::text, 'csv'::text]));

-- ── health_alerts.alert_type: dqm_crm_sync -> dqm_outcome_sync ──────────────
-- Live constraint read directly before this migration (Key Technical
-- Decision §21/§22's read-before-widen discipline) — every other existing
-- value is carried forward unchanged; confirmed zero rows carry
-- 'dqm_crm_sync' before renaming the enum value.
ALTER TABLE health_alerts DROP CONSTRAINT health_alerts_alert_type_check;
ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
  CHECK (alert_type = ANY (ARRAY[
    'capi_delivery'::text, 'tag_firing'::text, 'consent_missing'::text, 'no_recent_audit'::text,
    'capi_not_configured'::text, 'recon_critical_finding'::text, 'recon_brief_misaligned'::text,
    'connection_expired'::text, 'dqm_gtg'::text, 'dqm_dma'::text, 'dqm_sgtm'::text,
    'dqm_google_delivery'::text, 'dqm_outcome_sync'::text
  ]));

-- ── dqm_run_log.check_type: crm_sync -> outcome_sync ────────────────────────
-- Kept in lockstep with the alert_type rename above — dqmOrchestrator.ts
-- writes both under the same renamed checkType constant, so leaving one
-- renamed and the other not would be a silent half-rename. Confirmed zero
-- rows carry 'crm_sync' before renaming.
ALTER TABLE dqm_run_log DROP CONSTRAINT dqm_run_log_check_type_check;
ALTER TABLE dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
  CHECK (check_type = ANY (ARRAY['gtg'::text, 'dma'::text, 'sgtm'::text, 'meta_emq'::text, 'outcome_sync'::text]));
