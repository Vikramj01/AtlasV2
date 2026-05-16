-- IHC Sprint C — add consecutive_fail_count to audit_findings
-- Tracks how many consecutive rule-evaluation runs produced a failure.
-- Drift rules (5.12–5.14) require 2 consecutive failures before status → 'open'
-- to suppress transient CSE flakiness.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'audit_findings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_findings' AND column_name = 'consecutive_fail_count'
    ) THEN
      ALTER TABLE audit_findings
        ADD COLUMN consecutive_fail_count integer NOT NULL DEFAULT 0;
    END IF;
  END IF;
END
$$;
