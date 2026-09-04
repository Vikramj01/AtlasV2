-- audits.coverage_fingerprint / audits.pages_distinct (Site Evaluation
-- Coverage & Honesty PRD §9, Phase 2).
--
-- pages_distinct makes "share of quick scans resolving >= 2 distinct
-- pages" (§14) a one-line query instead of requiring every caller to
-- unpack the audit_reports.report_json blob.
--
-- coverage_fingerprint — a stable hash of the sorted set of normalised
-- URLs a run actually, successfully visited — is what the scheduled-audit
-- regression comparator (queue/worker.ts) needs to tell "the score
-- genuinely regressed" apart from "Phase 2's page discovery started
-- finding real checkout pages that used to be scored as the homepage."
-- Without it, the moment discovery starts working, coverage rising would
-- itself look like a tracking regression across the estate.
--
-- Both nullable — an audit with no step_coverage (Journey-Builder mode, a
-- run predating this field) simply has neither, same as it has no
-- executive_summary.coverage in its report.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS coverage_fingerprint TEXT,
      ADD COLUMN IF NOT EXISTS pages_distinct INTEGER;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scheduled_audits') THEN
    -- Set alongside last_audit_rule_set_version (20260903001) by the same
    -- updateScheduleScore() call — the regression comparator needs both
    -- the previous run's rule_set_version AND its coverage_fingerprint to
    -- decide whether two runs' scores are actually comparable.
    ALTER TABLE public.scheduled_audits
      ADD COLUMN IF NOT EXISTS last_audit_coverage_fingerprint TEXT;
  END IF;
END $$;
