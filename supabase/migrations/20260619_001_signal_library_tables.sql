-- Signal Library tables
-- Creates: signals, signal_packs, signal_pack_signals, deployments
-- RLS enabled on all tables; system rows (is_system = true) are readable by all orgs.

-- ── signals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID        REFERENCES organisations(id) ON DELETE CASCADE,
  key                   TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  description           TEXT        NOT NULL DEFAULT '',
  category              TEXT        NOT NULL DEFAULT 'custom'
                                    CHECK (category IN ('conversion','engagement','navigation','custom')),
  is_system             BOOLEAN     NOT NULL DEFAULT false,
  is_custom             BOOLEAN     NOT NULL DEFAULT false,
  source_action_primitive TEXT,
  required_params       JSONB       NOT NULL DEFAULT '[]',
  optional_params       JSONB       NOT NULL DEFAULT '[]',
  platform_mappings     JSONB       NOT NULL DEFAULT '{}',
  taxonomy_event_id     UUID        REFERENCES event_taxonomy(id) ON DELETE SET NULL,
  taxonomy_path         TEXT,
  version               INTEGER     NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Org-scoped signals must have a unique key per org; system signals must have a unique key globally.
CREATE UNIQUE INDEX IF NOT EXISTS signals_org_key_unique
  ON signals (organisation_id, key)
  WHERE organisation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS signals_system_key_unique
  ON signals (key)
  WHERE is_system = true;

CREATE INDEX IF NOT EXISTS idx_signals_org      ON signals (organisation_id);
CREATE INDEX IF NOT EXISTS idx_signals_category ON signals (category);
CREATE INDEX IF NOT EXISTS idx_signals_taxonomy ON signals (taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL;

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals: read system or own org"
  ON signals FOR SELECT
  USING (
    is_system = true
    OR organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signals: insert own org"
  ON signals FOR INSERT
  WITH CHECK (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signals: update own org"
  ON signals FOR UPDATE
  USING (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signals: delete own org"
  ON signals FOR DELETE
  USING (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- ── signal_packs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_packs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  business_type   TEXT        NOT NULL DEFAULT 'general',
  is_system       BOOLEAN     NOT NULL DEFAULT false,
  version         INTEGER     NOT NULL DEFAULT 1,
  signals_count   INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_packs_org ON signal_packs (organisation_id);

ALTER TABLE signal_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signal_packs: read system or own org"
  ON signal_packs FOR SELECT
  USING (
    is_system = true
    OR organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signal_packs: insert own org"
  ON signal_packs FOR INSERT
  WITH CHECK (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signal_packs: update own org"
  ON signal_packs FOR UPDATE
  USING (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "signal_packs: delete own org"
  ON signal_packs FOR DELETE
  USING (
    organisation_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- ── signal_pack_signals ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_pack_signals (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id       UUID    NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_id     UUID    NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  stage_hint    TEXT,
  is_required   BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE (pack_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_sps_pack   ON signal_pack_signals (pack_id);
CREATE INDEX IF NOT EXISTS idx_sps_signal ON signal_pack_signals (signal_id);

ALTER TABLE signal_pack_signals ENABLE ROW LEVEL SECURITY;

-- Readable if the linked pack is readable (system or same org)
CREATE POLICY "signal_pack_signals: read via pack"
  ON signal_pack_signals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM signal_packs sp
      WHERE sp.id = pack_id
        AND (
          sp.is_system = true
          OR sp.organisation_id = (
            SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
          )
        )
    )
  );

CREATE POLICY "signal_pack_signals: write via pack"
  ON signal_pack_signals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM signal_packs sp
      WHERE sp.id = pack_id
        AND sp.organisation_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
        )
    )
  );

-- ── deployments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deployments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pack_id           UUID        NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_overrides  JSONB       NOT NULL DEFAULT '{}',
  deployed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_generated_at TIMESTAMPTZ,
  UNIQUE (client_id, pack_id)
);

CREATE INDEX IF NOT EXISTS idx_deployments_client ON deployments (client_id);
CREATE INDEX IF NOT EXISTS idx_deployments_pack   ON deployments (pack_id);

ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deployments: read own org"
  ON deployments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id
        AND c.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
        )
    )
  );

CREATE POLICY "deployments: write own org"
  ON deployments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id
        AND c.organization_id = (
          SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
        )
    )
  );
