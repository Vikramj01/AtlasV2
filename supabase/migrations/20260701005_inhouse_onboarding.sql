-- PRD-005: In-House Marketer Onboarding
-- Add primary_client_id and signup_website_url to organisations for brand accounts.

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organisations') THEN
    ALTER TABLE organisations
      ADD COLUMN IF NOT EXISTS primary_client_id  UUID REFERENCES clients(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS signup_website_url TEXT;
  END IF;
END $$;
