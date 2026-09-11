-- signal_conflicts (Pre-Connection Scan Confidence Tiering PRD §6, Sprint 4
-- of docs/atlas-sprint-plan-pre-connection-confidence-tiering.md).
--
-- One row per fired cross-signal consistency assertion (CONF_01-CONF_05,
-- signalConsistency.ts) — two independent detectors disagreeing about the
-- same entity (e.g. GA4's dataLayer config() call vs its own absence in the
-- network-request-based verdict). Written once per audit run, purely for
-- audit/debugging visibility into what the checker found; the rendered
-- report reads the equivalent could_not_be_assessed entries (kind:
-- 'CONFLICT') already embedded in audit_reports.report_json, not this
-- table directly.
--
-- RLS pattern: audit_id IN (SELECT id FROM audits WHERE user_id = auth.uid()),
-- matching audit_results/audit_reports in 20260301001_consolidated_foundation_tables.sql
-- — audits is a foundational table guaranteed to exist, so this is a plain
-- CREATE TABLE rather than the DO $$ IF EXISTS $$ guard reserved for
-- ALTER TABLE on optional tables.

CREATE TABLE IF NOT EXISTS public.signal_conflicts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id           UUID        NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  assertion_id       TEXT        NOT NULL CHECK (assertion_id IN ('CONF_01', 'CONF_02', 'CONF_03', 'CONF_04', 'CONF_05')),
  entity             TEXT        NOT NULL,
  source_a           TEXT        NOT NULL,
  reading_a          TEXT        NOT NULL,
  source_b           TEXT        NOT NULL,
  reading_b          TEXT        NOT NULL,
  affected_rule_ids  JSONB       NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_conflicts_audit_id ON public.signal_conflicts (audit_id);

ALTER TABLE public.signal_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_conflicts_owner" ON public.signal_conflicts;
CREATE POLICY "signal_conflicts_owner"
  ON public.signal_conflicts FOR ALL
  USING (
    audit_id IN (SELECT id FROM public.audits WHERE user_id = auth.uid())
  );
