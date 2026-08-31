-- sGTM (server-side GTM) detection + monitoring — Sprint 3, Option 3.
--
-- Tag-generation (routing GA4 traffic through a verified server container)
-- is explicitly deferred pending verification of GTM's actual tag-JSON
-- schema for it — see the plan discussion. This migration covers only:
--   A. Verifying a client's claimed sGTM endpoint (client_platforms) is
--      real and reachable.
--   B. Per-client DQM health monitoring of verified endpoints, mirroring
--      dqm_gtg_checks (20260615001_dqm_tables.sql).

-- ── A. Verification flags on the existing sgtm client_platforms row ──────────
-- The sGTM URL is already captured (ClientSetupWizard Step 3's PLATFORM_FIELDS,
-- platform='sgtm', URL in measurement_id) — this just adds "did Atlas confirm
-- it's actually reachable" tracking.

ALTER TABLE public.client_platforms
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.client_platforms
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL;

-- ── B. Per-client sGTM health checks ──────────────────────────────────────────
-- Unlike dqm_gtg_checks (org-level only — a known gap noted in gtgProbe.ts's
-- own comments), sGTM endpoints are inherently per-client, so this table
-- tracks client_id from the start.

CREATE TABLE IF NOT EXISTS dqm_sgtm_checks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL,
  client_id     UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  transport_url TEXT        NOT NULL,
  http_status   INTEGER,
  response_ms   INTEGER,
  check_status  TEXT        NOT NULL CHECK (check_status IN ('pass', 'degraded', 'fail', 'timeout', 'error')),
  error_message TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqm_sgtm_checks_org_checked
  ON dqm_sgtm_checks(org_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_dqm_sgtm_checks_client
  ON dqm_sgtm_checks(client_id, checked_at DESC);

ALTER TABLE dqm_sgtm_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON dqm_sgtm_checks;
CREATE POLICY "user_isolation" ON dqm_sgtm_checks
  FOR ALL USING (org_id = auth.uid());

-- dqm_run_log.check_type CHECK constraint only allows ('gtg', 'dma') —
-- widen it to include the new 'sgtm' check type.
ALTER TABLE public.dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
ALTER TABLE public.dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
  CHECK (check_type IN ('gtg', 'dma', 'sgtm'));
