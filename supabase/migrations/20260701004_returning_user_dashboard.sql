-- PRD-004: Returning User Steady-State Dashboard
-- Track per-user login times and persist dashboard alert review state.

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS previous_login_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dashboard_alert_reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source_table    TEXT        NOT NULL,
  source_id       UUID        NOT NULL,
  reviewed_by     UUID        REFERENCES profiles(id),
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_table, source_id)
);

ALTER TABLE dashboard_alert_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members access alert reviews" ON dashboard_alert_reviews;
CREATE POLICY "org members access alert reviews"
  ON dashboard_alert_reviews
  USING (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE INDEX IF NOT EXISTS idx_alert_reviews_lookup
  ON dashboard_alert_reviews (organization_id, source_table, source_id);
