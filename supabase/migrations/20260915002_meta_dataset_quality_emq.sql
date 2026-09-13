-- Meta live Event Match Quality (EMQ) feedback sync.
--
-- Atlas already computes a pre-flight, internal Signal Enrichment Score
-- (0-100, via enrichmentConfigService) but never fetched Meta's own
-- post-delivery match-quality score back. This adds a table for the live
-- score fetched from Meta's Dataset Quality API
-- (GET /v{version}/dataset_quality?dataset_id=<id>&fields=web{event_match_quality{diagnostics},event_name}),
-- kept distinct from the pre-flight score since they measure different
-- things (configuration completeness vs. actual delivered match quality).

CREATE TABLE IF NOT EXISTS dqm_meta_emq_checks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  capi_provider_id  UUID        NOT NULL REFERENCES public.capi_providers(id) ON DELETE CASCADE,
  dataset_id        TEXT        NOT NULL,
  event_name        TEXT,
  emq_score         NUMERIC,
  diagnostics       JSONB,
  check_status      TEXT        NOT NULL CHECK (check_status IN ('ok', 'error')),
  error_message     TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqm_meta_emq_checks_org_checked
  ON dqm_meta_emq_checks(org_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_dqm_meta_emq_checks_provider
  ON dqm_meta_emq_checks(capi_provider_id, checked_at DESC);

ALTER TABLE dqm_meta_emq_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON dqm_meta_emq_checks;
CREATE POLICY "user_isolation" ON dqm_meta_emq_checks
  FOR ALL USING (org_id = auth.uid());

-- dqm_run_log.check_type CHECK constraint only allows ('gtg', 'dma', 'sgtm') —
-- widen it to include the new 'meta_emq' check type.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_run_log') THEN
    ALTER TABLE public.dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
    ALTER TABLE public.dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
      CHECK (check_type IN ('gtg', 'dma', 'sgtm', 'meta_emq'));
  END IF;
END $$;
