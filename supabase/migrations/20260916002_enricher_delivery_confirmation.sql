-- Follow-up to 20260916001_google_delivery_confirmation.sql: that migration
-- scoped requestStatus:retrieve confirmation to the events:ingest path only
-- (live CAPI + offline CSV upload). The audienceMembers:ingest/:remove path
-- (Customer Match / Bid Signal Enricher, enricherService.ts) was left out —
-- it wrote enricher_runs.status = 'completed' and matched_count =
-- contacts.length synchronously on a bare 2xx from Google, treating
-- "accepted for processing" as "matched". dqm_dma_poll_state.upload_success_rate
-- (surfaced in the Data Manager Console) is computed directly off that status
-- column, so a client could show 100% success while Google silently rejected
-- rows and nothing would ever correct it. This adds the same confirmation
-- columns capi_events/offline_conversion_uploads already have.

ALTER TABLE public.enricher_runs ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE public.enricher_runs ADD COLUMN IF NOT EXISTS delivery_confirmed_status TEXT
  CHECK (delivery_confirmed_status IS NULL OR delivery_confirmed_status IN (
    'confirmed_success', 'confirmed_partial', 'confirmed_failed', 'poll_exhausted'
  ));
ALTER TABLE public.enricher_runs ADD COLUMN IF NOT EXISTS delivery_confirmation JSONB;
ALTER TABLE public.enricher_runs ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.enricher_runs ADD COLUMN IF NOT EXISTS delivery_poll_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_enricher_runs_provider_request_id
  ON public.enricher_runs(provider_request_id) WHERE provider_request_id IS NOT NULL;

-- No status CHECK constraint exists on enricher_runs (free-text column per
-- 20260612_001_enricher_runs.sql), so the escalate-only 'completed' → 'partial'
-- downgrade (mirroring offline_conversion_uploads' convention) needs no
-- constraint change here.
