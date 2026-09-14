-- Google Stack Alignment sprint plan, Sprint 8: delivery confirmation & DQM alerts.
--
-- events:ingest's 2xx response only confirms submission (requestId +
-- fieldWarnings) — it is not per-event delivery truth. Google's
-- requestStatus:retrieve endpoint (verified live against the Data Manager
-- API Discovery Document, revision 20260904 — same revision already
-- verified for dmaTypes.ts) is the only way to learn what actually
-- happened, on a bounded async poll after submission.

-- ── A. Delivery confirmation columns on capi_events (live CAPI path) ─────────
-- One events:ingest call per Atlas event here (pipeline.ts's deliverToProvider
-- always sends a single-event array to Google), so one requestId maps to
-- exactly one row — genuine per-event confirmation, not just per-batch.

ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS delivery_confirmed_status TEXT
  CHECK (delivery_confirmed_status IS NULL OR delivery_confirmed_status IN (
    'confirmed_success', 'confirmed_partial', 'confirmed_failed', 'poll_exhausted'
  ));
ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS delivery_confirmation JSONB;
ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS delivery_poll_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_capi_events_provider_request_id
  ON public.capi_events(provider_request_id) WHERE provider_request_id IS NOT NULL;

-- ── B. Delivery confirmation columns on offline_conversion_uploads ──────────
-- Batches of up to 2,000 rows share one requestId (googleOfflineUpload.ts's
-- BATCH_SIZE) — this is batch-level truth, not per-row; requestStatus:retrieve
-- has no per-row identifier on its own schema (see dmaTypes.ts's
-- DMARequestStatusPerDestination comment). Existing `status` transitions are
-- escalate-only here — a confirmed failure can downgrade 'completed' to
-- 'partial', mirroring the org health_level convention elsewhere
-- (Ecommerce Signal Completeness Sprint 1) — never upgrades 'partial'/'failed'
-- back to 'completed'.

ALTER TABLE public.offline_conversion_uploads ADD COLUMN IF NOT EXISTS provider_request_ids TEXT[];
ALTER TABLE public.offline_conversion_uploads ADD COLUMN IF NOT EXISTS delivery_confirmation JSONB;
ALTER TABLE public.offline_conversion_uploads ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.offline_conversion_uploads ADD COLUMN IF NOT EXISTS delivery_poll_attempts INTEGER NOT NULL DEFAULT 0;

-- ── C. health_alerts.alert_type: add dqm_google_delivery, and fix a latent
--       pre-existing gap found while widening this same constraint ─────────
--
-- dqm_sgtm has been a live AlertType (backend/src/types/health.ts) and is
-- actively inserted by dqmOrchestrator.ts's applyAlertDecision() whenever an
-- sGTM alert opens, since the sGTM detection & monitoring sprint — but
-- 20260710_001_dqm_completion.sql (the only migration that has ever touched
-- this constraint) widened it for 'dqm_gtg'/'dqm_dma' only and never added
-- 'dqm_sgtm'. Every attempted INSERT for a genuine sGTM alert has been
-- throwing a CHECK violation in createAlert() (which re-throws on error) —
-- a client's unreachable verified server-side GTM endpoint has never
-- actually been able to open an alert. Fixed here since this migration
-- already re-declares the same constraint.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_alerts') THEN
    ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
    ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
      CHECK (alert_type IN (
        'capi_delivery', 'tag_firing', 'consent_missing',
        'no_recent_audit', 'capi_not_configured',
        'recon_critical_finding', 'recon_brief_misaligned',
        'connection_expired',
        'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery'
      ));
  END IF;
END $$;
