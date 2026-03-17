-- ============================================================
-- COMPOSABLE SIGNALS — MIGRATION 3
-- Signal Library: signals, signal_packs, signal_pack_signals
--
-- Run AFTER migration 1.
-- ============================================================

-- ── signals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         UUID        REFERENCES organisations(id) ON DELETE CASCADE,
  key                     TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  description             TEXT        NOT NULL DEFAULT '',
  category                TEXT        NOT NULL CHECK (category IN ('conversion','engagement','navigation','custom')),
  is_system               BOOLEAN     NOT NULL DEFAULT false,
  is_custom               BOOLEAN     NOT NULL DEFAULT false,
  source_action_primitive TEXT,
  required_params         JSONB       NOT NULL DEFAULT '[]',
  optional_params         JSONB       NOT NULL DEFAULT '[]',
  platform_mappings       JSONB       NOT NULL DEFAULT '{}',
  walkeros_mapping        JSONB,
  version                 INTEGER     NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- system signals have NULL org; org signals must be unique per org+key
  UNIQUE NULLS NOT DISTINCT (organisation_id, key)
);

-- ── signal_packs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_packs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  business_type   TEXT        NOT NULL DEFAULT 'custom',
  is_system       BOOLEAN     NOT NULL DEFAULT false,
  version         INTEGER     NOT NULL DEFAULT 1,
  signals_count   INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── signal_pack_signals ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_pack_signals (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id       UUID    NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_id     UUID    NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  stage_hint    TEXT,
  is_required   BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pack_id, signal_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_signals_org           ON signals(organisation_id);
CREATE INDEX IF NOT EXISTS idx_signals_system        ON signals(is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_signals_key           ON signals(key);
CREATE INDEX IF NOT EXISTS idx_signal_packs_org      ON signal_packs(organisation_id);
CREATE INDEX IF NOT EXISTS idx_signal_packs_system   ON signal_packs(is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_sps_pack              ON signal_pack_signals(pack_id);
CREATE INDEX IF NOT EXISTS idx_sps_signal            ON signal_pack_signals(signal_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE signals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_packs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_pack_signals ENABLE ROW LEVEL SECURITY;

-- signals: anyone can read system signals; org members can CRUD org signals
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signals' AND policyname = 'Read system signals'
  ) THEN
    CREATE POLICY "Read system signals" ON signals
      FOR SELECT USING (is_system = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signals' AND policyname = 'Org members access org signals'
  ) THEN
    CREATE POLICY "Org members access org signals" ON signals
      FOR ALL USING (
        organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- signal_packs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signal_packs' AND policyname = 'Read system packs'
  ) THEN
    CREATE POLICY "Read system packs" ON signal_packs
      FOR SELECT USING (is_system = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signal_packs' AND policyname = 'Org members access org packs'
  ) THEN
    CREATE POLICY "Org members access org packs" ON signal_packs
      FOR ALL USING (
        organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- signal_pack_signals: accessible if the parent pack is readable
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signal_pack_signals' AND policyname = 'Access pack signals via pack'
  ) THEN
    CREATE POLICY "Access pack signals via pack" ON signal_pack_signals
      FOR ALL USING (
        pack_id IN (
          SELECT id FROM signal_packs WHERE is_system = true
          UNION
          SELECT sp.id FROM signal_packs sp
          JOIN organisation_members om ON om.organisation_id = sp.organisation_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;
