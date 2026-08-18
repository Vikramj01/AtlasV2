-- Sprint 1: Evaluation flow — link Audit Engine runs to an existing client
--
-- Adds an optional client_id to the audits table so a bare-URL evaluation
-- (run with no client selected, e.g. for an agency pitching a prospect) can be
-- linked to an existing client afterward from the report view. The audits
-- table predates the supabase/migrations/ convention (originally provisioned
-- by db/migrations/001_create_audit_tables.sql) — guarded defensively per the
-- project's ALTER TABLE convention in case that file hasn't run in a given
-- environment.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_audits_client_id ON public.audits(client_id);
  END IF;
END $$;
