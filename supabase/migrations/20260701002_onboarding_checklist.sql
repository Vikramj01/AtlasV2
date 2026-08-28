-- PRD-002: Agency Onboarding Checklist
-- Adds taxonomy_accepted_at to organisations, is_starter to signal_packs,
-- and creates organisation_onboarding_state for skip/dismiss/completion tracking.

-- ── organisations: add taxonomy_accepted_at ───────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organisations') THEN
    ALTER TABLE organisations
      ADD COLUMN IF NOT EXISTS taxonomy_accepted_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── signal_packs: add is_starter ──────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_packs') THEN
    ALTER TABLE signal_packs
      ADD COLUMN IF NOT EXISTS is_starter BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- ── organisation_onboarding_state ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisation_onboarding_state (
  organization_id   UUID        PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  steps_state       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dismissed_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE organisation_onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members access onboarding state"
  ON organisation_onboarding_state
  USING (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

-- ── Starter signal packs seed ─────────────────────────────────────────────────
INSERT INTO signal_packs (id, organisation_id, name, description, is_system, is_starter)
VALUES
  (gen_random_uuid(), NULL, 'B2B SaaS Standard',        'Core conversion events for B2B SaaS products',         TRUE, TRUE),
  (gen_random_uuid(), NULL, 'Lead Gen Essentials',       'Lead generation signals for form-based acquisition',   TRUE, TRUE),
  (gen_random_uuid(), NULL, 'Ecommerce Growth',          'Purchase funnel events for ecommerce businesses',      TRUE, TRUE),
  (gen_random_uuid(), NULL, 'Marketplace Standard',      'Buyer and seller signals for marketplace platforms',   TRUE, TRUE),
  (gen_random_uuid(), NULL, 'Nonprofit Essentials',      'Donation and engagement signals for nonprofits',       TRUE, TRUE)
ON CONFLICT DO NOTHING;
