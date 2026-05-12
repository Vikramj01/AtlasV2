-- Link journeys to clients (optional, for agency workflow where the wizard is
-- launched from a specific client's page). Null means the journey is standalone.
-- Guarded: safe to run on databases where journeys or clients may not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journeys')
  AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    EXECUTE 'ALTER TABLE public.journeys ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL';
    IF NOT EXISTS (
      SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'journeys' AND indexname = 'idx_journeys_client_id'
    ) THEN
      EXECUTE 'CREATE INDEX idx_journeys_client_id ON public.journeys (client_id) WHERE client_id IS NOT NULL';
    END IF;
  END IF;
END $$;
