-- DQM Phase 2 completion
-- Closes four gaps: degraded classification, backoff tracking, per-org config, run log, alert types.
-- All ALTER TABLE statements are guarded with IF EXISTS / IF NOT EXISTS for preview-env safety.

-- 1. Extend health_alerts.alert_type constraint to include DQM alert types
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_alerts') THEN
    ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
    ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
      CHECK (alert_type IN (
        'capi_delivery', 'tag_firing', 'consent_missing',
        'no_recent_audit', 'capi_not_configured',
        'recon_critical_finding', 'recon_brief_misaligned',
        'connection_expired',
        'dqm_gtg', 'dqm_dma'
      ));
  END IF;
END $$;

-- 2. Extend dqm_gtg_checks.check_status constraint to include 'degraded'
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_gtg_checks') THEN
    ALTER TABLE dqm_gtg_checks DROP CONSTRAINT IF EXISTS dqm_gtg_checks_check_status_check;
    ALTER TABLE dqm_gtg_checks ADD CONSTRAINT dqm_gtg_checks_check_status_check
      CHECK (check_status IN ('pass', 'degraded', 'fail', 'timeout', 'error'));
  END IF;
END $$;

-- 3. Add consecutive_failures to dqm_dma_poll_state
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_dma_poll_state') THEN
    ALTER TABLE dqm_dma_poll_state
      ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 4. Per-org DQM thresholds
--    No FK on org_id — consistent with dqm_gtg_checks / dqm_dma_poll_state.
--    Rows are created on first probe run (INSERT ... ON CONFLICT DO NOTHING);
--    missing row = use column defaults, no backfill required.
CREATE TABLE IF NOT EXISTS public.dqm_org_config (
  org_id                           UUID    PRIMARY KEY,
  degraded_latency_threshold_ms    INT     NOT NULL DEFAULT 2000,
  dma_match_rate_warning_threshold NUMERIC NOT NULL DEFAULT 0.50,
  dma_match_rate_drop_pct_warning  NUMERIC NOT NULL DEFAULT 0.10,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dqm_org_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE tablename = 'dqm_org_config' AND policyname = 'dqm_org_config_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY dqm_org_config_org_access ON public.dqm_org_config
        USING (org_id = auth.uid());
    $p$;
  END IF;
END $$;

-- 5. Run-level audit log (backs alert dedup + recovery)
CREATE TABLE IF NOT EXISTS public.dqm_run_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  check_type   TEXT NOT NULL CHECK (check_type IN ('gtg', 'dma')),
  status       TEXT NOT NULL CHECK (status IN ('pass', 'degraded', 'fail', 'timeout', 'error', 'skipped-backoff')),
  latency_ms   INT,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduled', 'manual')),
  alert_action TEXT CHECK (alert_action IN ('none', 'open', 'update', 'resolve')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqm_run_log_org_created
  ON public.dqm_run_log (org_id, created_at DESC);

ALTER TABLE public.dqm_run_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE tablename = 'dqm_run_log' AND policyname = 'dqm_run_log_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY dqm_run_log_org_access ON public.dqm_run_log
        USING (org_id = auth.uid());
    $p$;
  END IF;
END $$;
