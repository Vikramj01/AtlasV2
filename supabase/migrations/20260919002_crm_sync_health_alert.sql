-- CRM Outcome Integration Sprint 8 (docs/prd/crm-outcome-integration.md §10).
--
-- health_alerts.alert_type already includes 'dqm_crm_sync' — added ahead of
-- time by 20260919001_crm_integration.sql's own migration (per that file's
-- comment: "Sprint 8 wires up the actual alert logic"). Nothing to widen
-- there. Two things ARE needed here:
--
-- 1. crm_sync_configs.consecutive_failures — the PRD's own alert-condition
--    table (§10) lists "Sync failed on consecutive runs" as a distinct
--    trigger, but crm_sync_configs only ever stored the LAST run's status
--    (last_sync_status), with no run history to derive "consecutive" from.
--    This column is genuinely new persistent state, not a Sprint 7-style
--    runtime parameter — mirrors health_alerts.consecutive_ok_count's
--    existing read-increment-write pattern, just for the opposite
--    direction (failures instead of successes).
--
-- 2. dqm_run_log.check_type CHECK constraint — currently ('gtg', 'dma',
--    'sgtm', 'meta_emq') per the live constraint read from
--    20260915002_meta_dataset_quality_emq.sql (the most recent migration to
--    touch it), enumerated here rather than reconstructed from memory, per
--    Key Technical Decision §21/§22's standing lesson on this exact
--    constraint's history of silently omitted values. Widened to add
--    'crm_sync' so runDQMForOrg()'s new CRM sync health check can log a run
--    the same way GTG/DMA/sGTM/Meta EMQ already do.

ALTER TABLE crm_sync_configs
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_run_log') THEN
    ALTER TABLE public.dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
    ALTER TABLE public.dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
      CHECK (check_type IN ('gtg', 'dma', 'sgtm', 'meta_emq', 'crm_sync'));
  END IF;
END $$;
