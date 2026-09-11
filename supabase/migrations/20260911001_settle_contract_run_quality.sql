-- audits.run_quality (Pre-Connection Scan Confidence Tiering PRD §7.3,
-- Sprint 1 of docs/atlas-sprint-plan-pre-connection-confidence-tiering.md).
--
-- Durable copy of the same run-level settle-reliability verdict the
-- report's own executive_summary.coverage.run_quality carries (computed by
-- backend/src/services/reporting/coverage.ts's computeRunQuality) — kept on
-- the row itself, not just inside audit_reports.report_json, so the export
-- route (POST /api/audits/:audit_id/export) can gate a client-facing
-- PDF/JSON/zip on it with a single-column read.
--
-- 'COMPLETE'    — every in-scope step reached 'settled'.
-- 'PROVISIONAL' — at least one step didn't settle, but not badly enough to
--                 withhold the report; the report header states this.
-- 'INSUFFICIENT'— the declared conversion surface never settled, or fewer
--                 than two steps settled overall. Blocks a client-facing
--                 export until the site is re-scanned.
--
-- Nullable — an audit with no step_coverage (Journey-Builder mode, a run
-- predating this migration) simply has no run_quality, same as it has no
-- executive_summary.coverage in its report.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS run_quality TEXT
        CHECK (run_quality IS NULL OR run_quality IN ('COMPLETE', 'PROVISIONAL', 'INSUFFICIENT'));
  END IF;
END $$;
