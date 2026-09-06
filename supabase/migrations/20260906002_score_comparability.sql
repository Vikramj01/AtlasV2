-- Score comparability (Report Correctness Programme PRD Part D).
--
-- register_version — the Check Register version (register/layers.ts's
-- REGISTER_VERSION) active when this audit's scan ran. Without it there is
-- no way to explain, after a rule addition/removal/severity-change release,
-- why a site's score moved (D4). Null for a v1-legacy audit (no Check
-- Register involved) or a v2 audit written before this migration.
--
-- conversion_signal_health_numerator / _denominator — the raw
-- severity-weighted units behind the header composite score (D3), durable
-- on the row so a later audit for the same site can compare its own
-- denominator against the prior run without unpacking
-- audit_reports.report_json. A denominator that moved between two audits
-- of the same site is a different fact from a score that moved because the
-- site changed, and the client will ask which.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS register_version TEXT,
      ADD COLUMN IF NOT EXISTS conversion_signal_health_numerator NUMERIC,
      ADD COLUMN IF NOT EXISTS conversion_signal_health_denominator NUMERIC;
  END IF;
END $$;

-- scheduled_audits.last_audit_register_version — set alongside
-- last_audit_rule_set_version/last_audit_coverage_fingerprint (20260903001/
-- 20260903002) by the same updateScheduleScore() call, so the regression
-- comparator (queue/regressionComparability.ts) can also skip a false
-- "regressed" alert when a Check Register release moved the denominator
-- between the two compared runs, not the site itself.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scheduled_audits') THEN
    ALTER TABLE public.scheduled_audits
      ADD COLUMN IF NOT EXISTS last_audit_register_version TEXT;
  END IF;
END $$;
