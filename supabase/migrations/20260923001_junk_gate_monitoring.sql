-- GA4 Admin / L11 / Junk Gate PRD Part C (C3): capture rules, hold-rate alert, DQM alert type.
--
-- Constraint lists below are 20260922002's (the newest migration touching either CHECK, itself a
-- superset of the live project's definitions as of 2026-10-06 — read before writing it) plus the
-- one new value each. Widened here so a constraint is never the reason the junk-gate alert
-- silently fails to open (the dqm_sgtm lesson, CLAUDE.md Sprint 8 of Google Stack Alignment).

-- JC_HONEYPOT_FILLED: the path of a honeypot field the client's form ALREADY has. NULL = not
-- mapped (the rule can only fire via the GTM beacon's honeypot selector).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_identity_configs') THEN
    ALTER TABLE client_identity_configs ADD COLUMN IF NOT EXISTS honeypot_field TEXT NULL;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'junk_gate_configs') THEN
    -- Flagged share (junk + suspect) of the last 24h above which the org gets a DQM alert.
    ALTER TABLE junk_gate_configs
      ADD COLUMN IF NOT EXISTS hold_rate_alert_pct integer NOT NULL DEFAULT 30
      CHECK (hold_rate_alert_pct BETWEEN 1 AND 100);
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_alerts') THEN
    ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
    ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
      CHECK (alert_type IN (
        'capi_delivery', 'tag_firing', 'consent_missing', 'no_recent_audit', 'capi_not_configured',
        'recon_critical_finding', 'recon_brief_misaligned', 'connection_expired',
        'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery', 'dqm_outcome_sync',
        'dqm_google_tag_topology', 'ga4_config_changed', 'dqm_junk_gate'
      ));
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_run_log') THEN
    ALTER TABLE dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
    ALTER TABLE dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
      CHECK (check_type IN ('gtg', 'dma', 'sgtm', 'meta_emq', 'outcome_sync', 'google_tag_topology', 'ga4_config', 'junk_gate'));
  END IF;
END $$;
