-- ============================================================
-- COMPOSABLE SIGNALS — MIGRATION 1
-- Organisations & Clients
--
-- Run in Supabase SQL Editor BEFORE migrations 2–5.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS guards are used.
-- ============================================================

-- ── Organisations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organisations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  owner_id    UUID        NOT NULL REFERENCES auth.users(id),
  plan        TEXT        NOT NULL DEFAULT 'agency' CHECK (plan IN ('pro', 'agency')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisation_members (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at      TIMESTAMPTZ,
  UNIQUE(organisation_id, user_id)
);

-- ── Clients ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  website_url       TEXT        NOT NULL,
  business_type     TEXT        NOT NULL DEFAULT 'custom'
                    CHECK (business_type IN ('ecommerce','saas','lead_gen','content','marketplace','custom')),
  detected_platform TEXT,
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_platforms (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform        TEXT    NOT NULL CHECK (platform IN ('ga4','google_ads','meta','sgtm','tiktok','linkedin')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  measurement_id  TEXT,
  config          JSONB   DEFAULT '{}',
  UNIQUE(client_id, platform)
);

CREATE TABLE IF NOT EXISTS client_pages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label        TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  page_type    TEXT        NOT NULL DEFAULT 'custom',
  stage_order  INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_organisations_owner   ON organisations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organisations_slug    ON organisations(slug);
CREATE INDEX IF NOT EXISTS idx_org_members_org       ON organisation_members(organisation_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user      ON organisation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_org           ON clients(organisation_id);
CREATE INDEX IF NOT EXISTS idx_client_platforms_cl   ON client_platforms(client_id);
CREATE INDEX IF NOT EXISTS idx_client_pages_cl       ON client_pages(client_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE organisations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_platforms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pages        ENABLE ROW LEVEL SECURITY;

-- organisations: members can read their org; owner has full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organisations' AND policyname = 'Members read own org'
  ) THEN
    CREATE POLICY "Members read own org" ON organisations
      FOR SELECT USING (
        id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organisations' AND policyname = 'Owners manage org'
  ) THEN
    CREATE POLICY "Owners manage org" ON organisations
      FOR ALL USING (owner_id = auth.uid());
  END IF;
END $$;

-- organisation_members
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organisation_members' AND policyname = 'Members see org members'
  ) THEN
    CREATE POLICY "Members see org members" ON organisation_members
      FOR SELECT USING (
        organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'organisation_members' AND policyname = 'Admins manage members'
  ) THEN
    CREATE POLICY "Admins manage members" ON organisation_members
      FOR ALL USING (
        organisation_id IN (
          SELECT organisation_id FROM organisation_members
          WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
      );
  END IF;
END $$;

-- clients
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND policyname = 'Org members access clients'
  ) THEN
    CREATE POLICY "Org members access clients" ON clients
      FOR ALL USING (
        organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- client_platforms
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'client_platforms' AND policyname = 'Org members access client platforms'
  ) THEN
    CREATE POLICY "Org members access client platforms" ON client_platforms
      FOR ALL USING (
        client_id IN (
          SELECT c.id FROM clients c
          JOIN organisation_members om ON om.organisation_id = c.organisation_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- client_pages
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'client_pages' AND policyname = 'Org members access client pages'
  ) THEN
    CREATE POLICY "Org members access client pages" ON client_pages
      FOR ALL USING (
        client_id IN (
          SELECT c.id FROM clients c
          JOIN organisation_members om ON om.organisation_id = c.organisation_id
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;
