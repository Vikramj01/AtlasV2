-- GA4 Admin / L11 / Junk Gate PRD §A.5: ga4_config_changed DQM alert.
--
-- Live definitions were read from the connected project before writing this
-- (CLAUDE.md §21 / the dqm_sgtm silent-CHECK-violation lesson):
--   health_alerts_alert_type_check → 14 values ending 'dqm_google_tag_topology'
--   dqm_run_log_check_type_check   → 'gtg','dma','sgtm','meta_emq','outcome_sync','google_tag_topology'
-- Both are widened here so the constraint is never the reason an alert silently
-- fails to open.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_alerts') THEN
    ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
    ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
      CHECK (alert_type IN (
        'capi_delivery', 'tag_firing', 'consent_missing', 'no_recent_audit', 'capi_not_configured',
        'recon_critical_finding', 'recon_brief_misaligned', 'connection_expired',
        'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery', 'dqm_outcome_sync',
        'dqm_google_tag_topology', 'ga4_config_changed'
      ));
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_run_log') THEN
    ALTER TABLE dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
    ALTER TABLE dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
      CHECK (check_type IN ('gtg', 'dma', 'sgtm', 'meta_emq', 'outcome_sync', 'google_tag_topology', 'ga4_config'));
  END IF;
END $$;
