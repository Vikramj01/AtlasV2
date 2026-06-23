-- Auto-insight Reporter (AIR) — core schema
-- Four tables: metric snapshots, anomalies, correlations, narrated insights.
-- All org-scoped with RLS consistent with other org-id tables (dqm_*, enricher_runs, etc).

-- ── air_metric_snapshots ──────────────────────────────────────────────────────
-- One row per (org, source, metric, dimension, date). Idempotent via UNIQUE.
-- dimension is null for account-level aggregates, campaign_id for breakdowns.

CREATE TABLE IF NOT EXISTS public.air_metric_snapshots (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID      NOT NULL,
  source        TEXT      NOT NULL CHECK (source IN ('ga4', 'google_ads', 'meta_ads')),
  metric_name   TEXT      NOT NULL,
  dimension     TEXT,
  value         NUMERIC   NOT NULL,
  snapshot_date DATE      NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, source, metric_name, dimension, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_air_snapshots_org_date
  ON public.air_metric_snapshots (org_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_air_snapshots_org_source_metric
  ON public.air_metric_snapshots (org_id, source, metric_name, dimension);

ALTER TABLE public.air_metric_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE tablename = 'air_metric_snapshots' AND policyname = 'air_snapshots_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY air_snapshots_org_access ON public.air_metric_snapshots
        USING (org_id = auth.uid());
    $p$;
  END IF;
END $$;

-- ── air_anomalies ─────────────────────────────────────────────────────────────
-- Detected deviations from expected range. Created by the anomaly detector
-- (Sprint 3); written after each ingestion run.

CREATE TABLE IF NOT EXISTS public.air_anomalies (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID      NOT NULL,
  source          TEXT      NOT NULL CHECK (source IN ('ga4', 'google_ads', 'meta_ads')),
  metric_name     TEXT      NOT NULL,
  dimension       TEXT,
  detected_date   DATE      NOT NULL,
  baseline_value  NUMERIC,
  observed_value  NUMERIC,
  deviation_pct   NUMERIC,
  severity        TEXT      NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, source, metric_name, dimension, detected_date)
);

CREATE INDEX IF NOT EXISTS idx_air_anomalies_org_date
  ON public.air_anomalies (org_id, detected_date DESC);

ALTER TABLE public.air_anomalies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE tablename = 'air_anomalies' AND policyname = 'air_anomalies_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY air_anomalies_org_access ON public.air_anomalies
        USING (org_id = auth.uid());
    $p$;
  END IF;
END $$;

-- ── air_insight_correlations ──────────────────────────────────────────────────
-- Atlas-internal signals correlated to an anomaly within a ±3-day window.
-- factor_ref_id is a nullable FK to the source table row (dqm_run_log.id,
-- detected_signals.id, etc) — nullable because not all factor types have a
-- single row to point at.

CREATE TABLE IF NOT EXISTS public.air_insight_correlations (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id       UUID      NOT NULL REFERENCES public.air_anomalies(id) ON DELETE CASCADE,
  factor_type      TEXT      NOT NULL CHECK (factor_type IN (
                     'dqm_alert', 'cse_signal_change', 'andromeda_score_drop', 'bse_delivery_failure'
                   )),
  factor_ref_id    UUID,
  factor_date      DATE      NOT NULL,
  proximity_days   INT       NOT NULL,
  confidence_score NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_air_correlations_anomaly
  ON public.air_insight_correlations (anomaly_id);

ALTER TABLE public.air_insight_correlations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE tablename = 'air_insight_correlations' AND policyname = 'air_correlations_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY air_correlations_org_access ON public.air_insight_correlations
        USING (
          anomaly_id IN (
            SELECT id FROM public.air_anomalies WHERE org_id = auth.uid()
          )
        );
    $p$;
  END IF;
END $$;

-- ── air_insights ──────────────────────────────────────────────────────────────
-- One narrated insight per anomaly. input_payload stores the full context
-- sent to the LLM so the output is auditable.

CREATE TABLE IF NOT EXISTS public.air_insights (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID      NOT NULL,
  anomaly_id    UUID      NOT NULL REFERENCES public.air_anomalies(id) ON DELETE CASCADE,
  narrative     TEXT      NOT NULL,
  input_payload JSONB     NOT NULL,
  model_version TEXT      NOT NULL,
  status        TEXT      NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_air_insights_org_status
  ON public.air_insights (org_id, status, created_at DESC);

ALTER TABLE public.air_insights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE tablename = 'air_insights' AND policyname = 'air_insights_org_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY air_insights_org_access ON public.air_insights
        USING (org_id = auth.uid());
    $p$;
  END IF;
END $$;
