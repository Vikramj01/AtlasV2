-- Phase 4: Platform Acceptance score column on health tables
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_scores') THEN
    ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS platform_acceptance_score NUMERIC;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_snapshots') THEN
    ALTER TABLE health_snapshots ADD COLUMN IF NOT EXISTS platform_acceptance_score NUMERIC;
  END IF;
END $$;
