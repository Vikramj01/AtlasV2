-- Fix organisation_onboarding_state's owner column name.
--
-- 20260701002_onboarding_checklist.sql's CREATE TABLE has always specified
-- organization_id (American) — the spelling every app-code query
-- (onboardingStatusService.ts, api/routes/onboarding.ts) uses, matching the
-- profiles.organization_id convention from 20260702_001. A fresh environment
-- applying migrations in order never hits this.
--
-- Production, however, had this table created out-of-band at some point with
-- organisation_id (British) instead, before 20260701002 itself was ever
-- applied there — discovered while reconciling prod against the repo's
-- migration history for the public-audit Check Register v2 rollout. Every
-- onboarding-status query against organization_id was silently failing
-- ("column does not exist"), breaking the Agency Onboarding Checklist
-- feature. Fixed directly in that database via the Supabase MCP tools; this
-- migration records the same fix in the repo so it's no longer only a
-- manual, undocumented change, and so any other environment carrying the
-- same drift self-heals the next time migrations run.
--
-- Guarded so it's a no-op both on a fresh environment (organisation_id never
-- existed) and on production (already renamed).

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'organisation_onboarding_state'
      AND column_name  = 'organisation_id'
  )
  AND NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'organisation_onboarding_state'
      AND column_name  = 'organization_id'
  ) THEN
    ALTER TABLE public.organisation_onboarding_state
      RENAME COLUMN organisation_id TO organization_id;
  END IF;
END $$;

-- Re-create the RLS policy against the correct column regardless of which
-- branch above ran, so a table that was already created correctly (fresh
-- environment) also ends up with this exact policy definition.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organisation_onboarding_state') THEN
    DROP POLICY IF EXISTS "org members access onboarding state" ON public.organisation_onboarding_state;
    CREATE POLICY "org members access onboarding state"
      ON public.organisation_onboarding_state
      USING (organization_id = (
        SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
      ))
      WITH CHECK (organization_id = (
        SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
      ));
  END IF;
END $$;
