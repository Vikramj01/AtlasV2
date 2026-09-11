-- Wires the no-login "free scan" (LoginPage/PublicAuditPage) onto the real
-- Check Register v2 audit engine instead of the standalone 9-check
-- publicAuditRunner.ts. A public run is now a real `audits` row — same
-- journeySimulator + runRegister pipeline authenticated scans use — with no
-- owning user; access is gated by a random public_token instead of
-- user_id/RLS (mirrors the token-only access model public_audit_runs already
-- used). runAuditOrchestrator already treats every org/user-scoped step as
-- optional (see orchestrator.ts's `auditRow?.user_id`/`orgId` guards), so no
-- orchestrator changes are needed — only the audits table needs to accept a
-- null owner.
--
-- The old public_audit_runs table (and its data) is left untouched — it's
-- no longer written to, but dropping it would destroy real captured leads.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ALTER COLUMN user_id DROP NOT NULL;

    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS is_public   BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS public_token UUID UNIQUE DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS ip_hash      TEXT,
      ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS lead_email   TEXT;

    CREATE INDEX IF NOT EXISTS idx_audits_public_expiry
      ON public.audits (expires_at) WHERE is_public;
  END IF;
END $$;
