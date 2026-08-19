-- Widen audit_results.status check constraint to match RuleStatus
--
-- The tag_configuration and implementation_drift rule layers (added after the
-- original 001_create_audit_tables.sql constraint was written) legitimately
-- return status: 'skipped' when no GTM container / CSE baseline is connected —
-- which is the normal case for a plain "Evaluate a site" audit. Since those
-- layers are always included in ALL_RULES, every audit run produced a
-- 'skipped' result and failed to insert into audit_results, causing every
-- audit to fail with "violates check constraint audit_results_status_check".
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_results') THEN
    ALTER TABLE public.audit_results DROP CONSTRAINT IF EXISTS audit_results_status_check;
    ALTER TABLE public.audit_results
      ADD CONSTRAINT audit_results_status_check
      CHECK (status IN ('pass', 'fail', 'warning', 'skipped', 'not_run'));
  END IF;
END $$;
