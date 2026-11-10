-- Google Tag Gateway PRD §6 (Sprint 3): endpoint registry, per-endpoint probe
-- results, and the capture/probe inputs the per-client status is combined from.
--
-- Live constraint state was read from the migration files, newest first (the
-- dqm_sgtm silent-CHECK-violation lesson, CLAUDE.md §21):
--   health_alerts_alert_type_check  (20260923001) already lists 'dqm_gtg'
--   dqm_run_log_check_type_check    (20260923001) already lists 'gtg'
--   dqm_gtg_checks_check_status_check (20260710001) = pass/degraded/fail/timeout/error
-- so nothing is widened here. Old dqm_gtg_checks rows (client_id NULL) probed
-- Google's own CDN, not the client; they stay as history and are excluded from
-- status computation.

-- ── 1. clients: the inputs gtg_status is combined from ───────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gtg_capture_status TEXT;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gtg_probe_status TEXT;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gtg_probe_checked_at TIMESTAMPTZ;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_gtg_capture_status_check') THEN
      ALTER TABLE public.clients ADD CONSTRAINT clients_gtg_capture_status_check
        CHECK (gtg_capture_status IS NULL OR gtg_capture_status IN ('unknown', 'detected_unverified', 'not_detected', 'partial'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_gtg_probe_status_check') THEN
      ALTER TABLE public.clients ADD CONSTRAINT clients_gtg_probe_status_check
        CHECK (gtg_probe_status IS NULL OR gtg_probe_status IN ('none', 'inconclusive', 'broken', 'ok', 'no_geo'));
    END IF;
  END IF;
END $$;

-- ── 2. client_gtg_endpoints ──────────────────────────────────────────────────
-- One client can run several reserved paths (one per GTM container, one per
-- standalone Google tag), which client_platforms' one-row-per-platform shape
-- does not fit (PRD D2).
CREATE TABLE IF NOT EXISTS client_gtg_endpoints (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  client_id        UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  hostname         TEXT        NOT NULL,
  reserved_path    TEXT        NOT NULL,
  tag_or_container TEXT        NOT NULL,
  source           TEXT        NOT NULL CHECK (source IN ('detected', 'operator_declared', 'atlas_generated')),
  is_verified      BOOLEAN     NOT NULL DEFAULT false,
  geo_verified     BOOLEAN     NOT NULL DEFAULT false,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, hostname, reserved_path),
  CHECK (reserved_path LIKE '/%' AND reserved_path <> '/' AND char_length(reserved_path) <= 100)
);

CREATE INDEX IF NOT EXISTS idx_client_gtg_endpoints_client ON client_gtg_endpoints (client_id);
CREATE INDEX IF NOT EXISTS idx_client_gtg_endpoints_org ON client_gtg_endpoints (org_id);

ALTER TABLE client_gtg_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_gtg_endpoints_org_read ON client_gtg_endpoints;
CREATE POLICY client_gtg_endpoints_org_read ON client_gtg_endpoints
  FOR SELECT USING (
    org_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR org_id = auth.uid()
  );

DROP POLICY IF EXISTS client_gtg_endpoints_service ON client_gtg_endpoints;
CREATE POLICY client_gtg_endpoints_service ON client_gtg_endpoints
  USING (auth.role() = 'service_role');

-- ── 3. dqm_gtg_checks: per-client / per-endpoint rows ────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dqm_gtg_checks') THEN
    ALTER TABLE dqm_gtg_checks ADD COLUMN IF NOT EXISTS client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE;
    ALTER TABLE dqm_gtg_checks ADD COLUMN IF NOT EXISTS endpoint_id UUID REFERENCES client_gtg_endpoints(id) ON DELETE SET NULL;
    ALTER TABLE dqm_gtg_checks ADD COLUMN IF NOT EXISTS geo_status  TEXT;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dqm_gtg_checks_geo_status_check') THEN
      ALTER TABLE dqm_gtg_checks ADD CONSTRAINT dqm_gtg_checks_geo_status_check
        CHECK (geo_status IS NULL OR geo_status IN ('pass', 'fail', 'skipped'));
    END IF;

    CREATE INDEX IF NOT EXISTS idx_dqm_gtg_checks_client ON dqm_gtg_checks (client_id, checked_at DESC)
      WHERE client_id IS NOT NULL;
  END IF;
END $$;
