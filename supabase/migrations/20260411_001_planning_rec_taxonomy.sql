-- Migration: Add taxonomy linking columns to planning_recommendations
-- Links AI-generated recommendations back to the org's event taxonomy.
-- taxonomy_event_id: FK to event_taxonomy.id (nullable — unmatched events stay null)
-- taxonomy_path: denormalised path string e.g. 'ecommerce/cart/add_to_cart' for display

-- Guarded: planning_recommendations is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_recommendations') THEN
    EXECUTE $q$
      ALTER TABLE planning_recommendations
        ADD COLUMN IF NOT EXISTS taxonomy_event_id UUID REFERENCES event_taxonomy(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS taxonomy_path TEXT
    $q$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_planning_rec_taxonomy_event_id ON planning_recommendations(taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL';
  END IF;
END $$;
