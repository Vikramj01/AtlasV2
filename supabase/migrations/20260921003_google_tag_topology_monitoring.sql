-- Google Tag Topology PRD §8 (Sprint 5): client-scoped discontinuities, AIR
-- correlation factor, DQM topology monitoring.
--
-- Live definitions were read from the connected project before writing this
-- (CLAUDE.md §21 / the dqm_sgtm silent-CHECK-violation lesson):
--   health_alerts_alert_type_check  → 13 values ending 'dqm_outcome_sync'
--   dqm_run_log_check_type_check    → 'gtg','dma','sgtm','meta_emq','outcome_sync'
--   air_insight_correlations_factor_type_check → 4 values
--   platform_discontinuities: columns id/platform/title/effective_date/description/created_at,
--     one policy "platform_discontinuities: read all" USING (true)

-- ── 1. platform_discontinuities: client-scoped rows ──────────────────────────
-- The existing read-all policy would expose one tenant's client-scoped rows to
-- every user, so it is replaced: platform-wide rows stay readable by all,
-- client-scoped rows only by the owning organisation's members.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_discontinuities') THEN
    ALTER TABLE platform_discontinuities
      ADD COLUMN IF NOT EXISTS client_id       uuid NULL REFERENCES clients(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS organization_id uuid NULL,
      ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'platform';

    ALTER TABLE platform_discontinuities DROP CONSTRAINT IF EXISTS platform_discontinuities_kind_check;
    ALTER TABLE platform_discontinuities ADD CONSTRAINT platform_discontinuities_kind_check
      CHECK (kind IN ('platform', 'client_tracking_change'));

    ALTER TABLE platform_discontinuities DROP CONSTRAINT IF EXISTS platform_discontinuities_scope_check;
    ALTER TABLE platform_discontinuities ADD CONSTRAINT platform_discontinuities_scope_check
      CHECK (
        (kind = 'platform' AND client_id IS NULL)
        OR (kind = 'client_tracking_change' AND client_id IS NOT NULL AND organization_id IS NOT NULL)
      );

    -- Idempotent writes: re-verifying a split must not duplicate its rows. A full
    -- (non-partial) constraint so PostgREST can target it with onConflict; NULL
    -- client_id rows (platform-wide) never collide because NULLs are distinct.
    ALTER TABLE platform_discontinuities DROP CONSTRAINT IF EXISTS platform_discontinuities_client_change_uq;
    ALTER TABLE platform_discontinuities ADD CONSTRAINT platform_discontinuities_client_change_uq
      UNIQUE (client_id, platform, effective_date, title);

    CREATE INDEX IF NOT EXISTS idx_platform_discontinuities_client
      ON platform_discontinuities (client_id) WHERE client_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_platform_discontinuities_org
      ON platform_discontinuities (organization_id, effective_date) WHERE organization_id IS NOT NULL;

    DROP POLICY IF EXISTS "platform_discontinuities: read all" ON platform_discontinuities;
    DROP POLICY IF EXISTS platform_discontinuities_read ON platform_discontinuities;
    CREATE POLICY platform_discontinuities_read ON platform_discontinuities
      FOR SELECT USING (
        kind = 'platform'
        OR organization_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          WHERE c.organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
        )
      );
  END IF;
END $$;

-- ── 2. AIR: a client tracking change is a correlation factor ─────────────────
ALTER TABLE air_insight_correlations DROP CONSTRAINT IF EXISTS air_insight_correlations_factor_type_check;
ALTER TABLE air_insight_correlations ADD CONSTRAINT air_insight_correlations_factor_type_check
  CHECK (factor_type IN ('dqm_alert', 'cse_signal_change', 'andromeda_score_drop', 'bse_delivery_failure', 'tracking_change'));

-- ── 3. DQM: per-client topology checks (dqm_sgtm_checks precedent) ───────────
CREATE TABLE IF NOT EXISTS dqm_google_tag_topology_checks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL,
  client_id        uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topology_verdict text        NOT NULL CHECK (topology_verdict IN ('SPLIT', 'COMBINED', 'COMBINED_ADS_PRIMARY', 'UNKNOWN')),
  recombined       boolean     NOT NULL DEFAULT false,
  ads_tag_lost     boolean     NOT NULL DEFAULT false,
  check_status     text        NOT NULL CHECK (check_status IN ('pass', 'degraded', 'fail', 'error')),
  checked_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqm_gtt_checks_org_checked ON dqm_google_tag_topology_checks (org_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_dqm_gtt_checks_client ON dqm_google_tag_topology_checks (client_id, checked_at DESC);

ALTER TABLE dqm_google_tag_topology_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_isolation" ON dqm_google_tag_topology_checks;
CREATE POLICY "user_isolation" ON dqm_google_tag_topology_checks FOR ALL USING (org_id = auth.uid());

ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
  CHECK (alert_type IN (
    'capi_delivery', 'tag_firing', 'consent_missing', 'no_recent_audit', 'capi_not_configured',
    'recon_critical_finding', 'recon_brief_misaligned', 'connection_expired',
    'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery', 'dqm_outcome_sync',
    'dqm_google_tag_topology'
  ));

ALTER TABLE dqm_run_log DROP CONSTRAINT IF EXISTS dqm_run_log_check_type_check;
ALTER TABLE dqm_run_log ADD CONSTRAINT dqm_run_log_check_type_check
  CHECK (check_type IN ('gtg', 'dma', 'sgtm', 'meta_emq', 'outcome_sync', 'google_tag_topology'));
