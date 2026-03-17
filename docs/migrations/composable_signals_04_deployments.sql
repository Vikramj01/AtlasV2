-- ============================================================
-- COMPOSABLE SIGNALS — MIGRATION 4
-- Deployments & Client Outputs
--
-- Run AFTER migration 3 (signal_packs must exist).
-- ============================================================

-- ── deployments ───────────────────────────────────────────────────────────────
-- One row per (client, pack) pair. Tracks when outputs were last generated.

CREATE TABLE IF NOT EXISTS deployments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pack_id           UUID        NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_overrides  JSONB       DEFAULT '{}',
  deployed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_generated_at TIMESTAMPTZ,
  UNIQUE(client_id, pack_id)
);

-- ── client_outputs ────────────────────────────────────────────────────────────
-- Versioned generated artefacts per client (GTM JSON, WalkerOS flow, etc.)

CREATE TABLE IF NOT EXISTS client_outputs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  output_type         TEXT        NOT NULL
                      CHECK (output_type IN ('gtm_container','walkeros_flow','datalayer_spec','implementation_guide')),
  output_data         JSONB,
  file_path           TEXT,
  version             INTEGER     NOT NULL DEFAULT 1,
  source_deployments  JSONB       NOT NULL DEFAULT '[]',
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_deployments_client       ON deployments(client_id);
CREATE INDEX IF NOT EXISTS idx_deployments_pack         ON deployments(pack_id);
CREATE INDEX IF NOT EXISTS idx_client_outputs_client    ON client_outputs(client_id);
CREATE INDEX IF NOT EXISTS idx_client_outputs_type      ON client_outputs(client_id, output_type);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE deployments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_outputs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deployments' AND policyname = 'Org members access deployments'
  ) THEN
    CREATE POLICY "Org members access deployments" ON deployments
      FOR ALL USING (
        client_id IN (
          SELECT c.id FROM clients c
          JOIN organisation_members om ON om.organisation_id = c.organisation_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'client_outputs' AND policyname = 'Org members access client outputs'
  ) THEN
    CREATE POLICY "Org members access client outputs" ON client_outputs
      FOR ALL USING (
        client_id IN (
          SELECT c.id FROM clients c
          JOIN organisation_members om ON om.organisation_id = c.organisation_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;
