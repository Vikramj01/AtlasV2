-- Cross-domain tracking support
-- Adds secondary_domains to planning_sessions and clients so the GTM generator
-- can emit linked_domains on the GA4 Config tag.

ALTER TABLE planning_sessions
  ADD COLUMN IF NOT EXISTS secondary_domains TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS secondary_domains TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END $$;
